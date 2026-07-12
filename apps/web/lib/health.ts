import type Stripe from 'stripe'
import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'

export interface CheckResult {
  ok: boolean
  detail?: string
}

const TIMEOUT_MS = 5_000

/** Statuspage.io endpoints polled alongside our own reachability probes. */
export const STATUS_PAGES = {
  elevenlabs_status: 'https://status.elevenlabs.io/api/v2/status.json',
  twilio_status: 'https://status.twilio.com/api/v2/status.json',
} as const

async function probe(fn: () => Promise<void>, timeoutMs: number): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Run every probe concurrently with a per-probe timeout. ok = all probes ok. */
export async function runHealthChecks<K extends string>(
  probes: Record<K, () => Promise<void>>,
  timeoutMs = TIMEOUT_MS
): Promise<{ ok: boolean; checks: Record<K, CheckResult> }> {
  const names = Object.keys(probes) as K[]
  const results = await Promise.all(names.map((n) => probe(probes[n], timeoutMs)))
  const checks = Object.fromEntries(names.map((n, i) => [n, results[i]])) as Record<K, CheckResult>
  return { ok: results.every((r) => r.ok), checks }
}

/** The app's real dependencies: Postgres, Stripe, and the voice provider. */
export function appProbes(db: SupabaseClient, stripe: Stripe, engine: VoiceEngine) {
  return {
    db: async () => {
      const { error } = await db.from('plans').select('id', { count: 'exact', head: true })
      if (error) throw new Error(error.message)
    },
    stripe: async () => {
      await stripe.balance.retrieve()
    },
    elevenlabs: () => engine.ping(),
  }
}

/** Statuspage.io shape: { status: { indicator: none|minor|major|critical, description } }. */
export function parseStatuspage(json: unknown): CheckResult {
  const status = (json as { status?: { indicator?: string; description?: string } } | null)?.status
  if (!status?.indicator) return { ok: false, detail: 'unrecognized statuspage payload' }
  if (status.indicator === 'none') return { ok: true }
  return { ok: false, detail: status.description ?? status.indicator }
}

export async function fetchStatuspage(url: string, fetchFn: typeof fetch = fetch): Promise<CheckResult> {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    return parseStatuspage(await res.json())
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Which providers just went down? Alerts fire on the healthy→down edge (or a
 * provider's first-ever down report), not on every poll of an ongoing outage —
 * one Sentry event per incident.
 */
export function downTransitions(
  prevOk: Record<string, boolean>,
  next: Record<string, CheckResult>
): string[] {
  return Object.entries(next)
    .filter(([name, r]) => !r.ok && prevOk[name] !== false)
    .map(([name, r]) => `${name}: ${r.detail ?? 'down'}`)
}
