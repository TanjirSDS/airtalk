// Phase 17 outbound delivery — the producer side of rule 2. We sign exactly the
// way packages/engine verifies inbound ElevenLabs webhooks:
//   header `airtalk-signature: t=<unix>,v0=<hex hmac-sha256("<t>.<body>")>`.
// Retries/backoff + dead-lettering come from the webhook-deliver Inngest function
// (lib/jobs.ts) — attemptDelivery throws to request a retry until MAX_ATTEMPTS.

import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@airtalk/db'

export const OUTBOUND_SIG_HEADER = 'airtalk-signature'
const MAX_ATTEMPTS = 5
const TIMEOUT_MS = 10_000

/** Signature header value for `body`, matching engine.verifyWebhook's format. */
export function signBody(secret: string, body: string, nowMs: number = Date.now()): string {
  const t = Math.floor(nowMs / 1000)
  const v0 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v0=${v0}`
}

export interface OutboundEvent {
  orgId: string
  eventType: string // 'call.completed' | 'alert.fired'
  eventKey: string // dedup key — provider_call_id (calls) or alert_event id (alerts)
  payload: unknown // provider-neutral shape (never a raw ElevenLabs payload — rule 1)
  /** When set, deliver to exactly these endpoints (alerts pick their own); when
   *  omitted, fan out to every enabled endpoint subscribed to eventType. */
  endpointIds?: string[]
}

/**
 * Insert one pending webhook_deliveries row per target endpoint (idempotent via
 * UNIQUE(endpoint_id, event_key) — a replay or reconcile re-emit is a no-op),
 * then queue each NEW delivery on Inngest. db must be the service client.
 */
export async function enqueueWebhookEvent(
  db: SupabaseClient,
  ev: OutboundEvent,
  // Injectable for tests; defaults to the real Inngest emit (lazy-imported so the
  // delivery unit test never has to resolve the inngest package).
  sendEvent?: (name: string, data: Record<string, unknown>) => Promise<boolean>
): Promise<void> {
  const send = sendEvent ?? (await import('./events')).emit
  const base = db.from('webhook_endpoints').select('id, events').eq('org_id', ev.orgId).eq('enabled', true)
  const { data } = ev.endpointIds ? await base.in('id', ev.endpointIds) : await base
  let endpoints = data ?? []
  // Fan-out (call.completed) only hits endpoints that subscribed to the type;
  // an explicit endpointIds list (alert.fired) was chosen by the user already.
  if (!ev.endpointIds) {
    endpoints = endpoints.filter((e) => Array.isArray(e.events) && e.events.includes(ev.eventType))
  }

  for (const ep of endpoints) {
    const { data: inserted } = await db
      .from('webhook_deliveries')
      .upsert(
        { endpoint_id: ep.id, event_type: ev.eventType, event_key: ev.eventKey, payload: ev.payload, status: 'pending' },
        { onConflict: 'endpoint_id,event_key', ignoreDuplicates: true }
      )
      .select('id')
    const id = inserted?.[0]?.id
    if (id) await send('webhook/deliver', { deliveryId: id })
  }
}

/**
 * One delivery attempt, driven by the webhook-deliver Inngest function. Signs +
 * POSTs the neutral payload, records attempts/last_attempt_at. On failure it
 * THROWS so Inngest retries with backoff — until attempts hits MAX_ATTEMPTS,
 * where the row is marked 'dead' (+ Sentry) and it returns instead of throwing.
 * A disabled endpoint stops delivery immediately (rule 3 kill switch). Secrets
 * are only used for signing — never logged.
 */
export async function attemptDelivery(
  db: SupabaseClient,
  deliveryId: string,
  fetchFn: typeof fetch = fetch,
  nowMs: () => number = Date.now
): Promise<string> {
  const { data: d } = await db
    .from('webhook_deliveries')
    .select('id, endpoint_id, event_type, event_key, payload, status, attempts')
    .eq('id', deliveryId)
    .maybeSingle()
  if (!d) return 'delivery gone'
  if (d.status === 'ok' || d.status === 'dead') return `already ${d.status}`

  const { data: ep } = await db
    .from('webhook_endpoints')
    .select('url, secret, enabled')
    .eq('id', d.endpoint_id)
    .maybeSingle()
  if (!ep) return 'endpoint gone'
  if (!ep.enabled) {
    await db.from('webhook_deliveries').update({ status: 'failed' }).eq('id', d.id)
    return 'endpoint disabled'
  }

  const attempts = (d.attempts ?? 0) + 1
  const body = JSON.stringify({ type: d.event_type, id: d.event_key, data: d.payload })
  let ok = false
  let detail = ''
  try {
    const res = await fetchFn(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [OUTBOUND_SIG_HEADER]: signBody(ep.secret, body, nowMs()) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    ok = res.ok
    detail = `HTTP ${res.status}`
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e)
  }

  const dead = !ok && attempts >= MAX_ATTEMPTS
  await db
    .from('webhook_deliveries')
    .update({
      status: ok ? 'ok' : dead ? 'dead' : 'failed',
      attempts,
      last_attempt_at: new Date(nowMs()).toISOString(),
    })
    .eq('id', d.id)

  if (ok) return `ok (attempt ${attempts})`
  if (dead) {
    console.error(`webhook delivery ${d.id} dead after ${attempts} attempts: ${detail}`)
    if (process.env.SENTRY_DSN) {
      const Sentry = await import('@sentry/nextjs')
      Sentry.captureMessage(`webhook delivery dead: ${detail}`, 'error')
    }
    return `dead: ${detail}`
  }
  // Not terminal → throw so Inngest retries with backoff.
  throw new Error(`webhook delivery ${d.id} attempt ${attempts} failed: ${detail}`)
}
