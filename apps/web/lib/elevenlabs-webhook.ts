import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'
import { upsertContact } from './contacts'
import { externalNumber, recordOptOut } from './opt-out'
import { deriveOutcome, type CallOutcome } from './outcome'
import { recordCallUsage } from './usage'

// Rule 2: verify signature → insert webhook_events (UNIQUE event_id, skip on
// conflict = idempotent) → store raw payload → then process.
// Extracted from the route so the idempotency test can inject a fake db.
export async function handleElevenLabsWebhook(
  rawBody: string,
  signature: string | null,
  engine: VoiceEngine,
  db: SupabaseClient,
  classify?: (transcript: unknown) => Promise<CallOutcome | null>,
  /** Phase 6: hand classification to Inngest (retries/backoff). Resolves false
   *  when the event wasn't accepted so the inline `classify` fallback runs. */
  enqueueClassify?: (providerCallId: string) => Promise<boolean>
): Promise<{ status: number; body: string }> {
  if (!engine.verifyWebhook({ rawBody, signature })) {
    return { status: 401, body: 'invalid signature' }
  }

  const payload = JSON.parse(rawBody)
  // ElevenLabs webhooks carry no event id; type + conversation_id is unique per event kind.
  const eventId = `${payload.type}:${payload.data?.conversation_id ?? 'unknown'}`

  const { data: inserted, error } = await db
    .from('webhook_events')
    .upsert(
      { provider: 'elevenlabs', event_id: eventId, payload },
      { onConflict: 'event_id', ignoreDuplicates: true }
    )
    .select()
  if (error) return { status: 500, body: error.message }
  if (!inserted?.length) return { status: 200, body: 'duplicate ignored' }

  if (payload.type === 'post_call_transcription') {
    const ev = engine.normalizeCallEvent(payload)
    const { data: agent } = await db
      .from('agents')
      .select('id, org_id')
      .eq('provider_agent_id', payload.data.agent_id)
      .maybeSingle()
    // Reconciliation may have inserted this call already — only count usage
    // for rows this webhook actually creates, or minutes double-count.
    const { data: existingCall } = await db
      .from('calls')
      .select('id')
      .eq('provider_call_id', ev.providerCallId)
      .maybeSingle()
    // Phase 7: a Cal.com booking made mid-call was parked in call_bookings
    // (the calls row didn't exist yet) — land it on the row we're writing.
    const { data: booking } = await db
      .from('call_bookings')
      .select('booking_ref')
      .eq('provider_call_id', ev.providerCallId)
      .maybeSingle()

    // Phase 14: auto-link a contact by the external number (customer side).
    // Done here — the only path that carries from/to — then inlined below so
    // it's one upsert, not a second update. Reconcile has no number (see contacts.ts).
    const extNum = externalNumber({ direction: ev.direction, from_e164: ev.fromE164, to_e164: ev.toE164 })
    const contactId = agent?.org_id && extNum ? await upsertContact(db, agent.org_id, extNum) : null

    const { data: callRow } = await db
      .from('calls')
      .upsert(
        {
          agent_id: agent?.id ?? null,
          org_id: agent?.org_id ?? null,
          contact_id: contactId,
          provider_call_id: ev.providerCallId,
          direction: ev.direction,
          from_e164: ev.fromE164,
          to_e164: ev.toE164,
          started_at: ev.startedAt,
          duration_secs: ev.durationSecs,
          transcript: ev.transcript,
          recording_url: ev.recordingUrl,
          status: ev.status,
          cost_cents: ev.costCents ?? null,
          booking_ref: booking?.booking_ref ?? null,
          // Phase 12: native post-call analysis (null when the payload carried none).
          analysis: ev.analysis ?? null,
        },
        { onConflict: 'provider_call_id' }
      )
      .select('id')
      .maybeSingle()

    // Phase 7: outbound campaign call finished → flip its contact to done.
    if (ev.direction === 'outbound') {
      await db
        .from('campaign_contacts')
        .update({ status: 'done', call_id: callRow?.id ?? null })
        .eq('provider_call_id', ev.providerCallId)
        .eq('status', 'calling')
    }

    // Phase 4: minute counting. A usage failure must not fail the webhook —
    // nightly reconciliation recomputes the period from calls anyway (rule 5).
    if (!existingCall && agent?.org_id && ev.durationSecs > 0) {
      await recordCallUsage(db, engine, agent.org_id, ev.durationSecs).catch((e) =>
        console.error('recordCallUsage failed:', e)
      )
    }

    // Phase 3: outcome extraction — best-effort, never fails the webhook.
    // Phase 6: prefer the Inngest queue; classify inline only when it refused.
    // Phase 12: EL analysis takes precedence over the classifier where decisive
    // (see deriveOutcome). The Inngest path applies the same precedence itself.
    const queued = enqueueClassify ? await enqueueClassify(ev.providerCallId).catch(() => false) : false
    if (!queued) {
      const result = classify ? await classify(ev.transcript).catch(() => null) : null
      const derived = deriveOutcome(result, ev.analysis ?? null)
      if (derived) {
        await db
          .from('calls')
          .update({ outcome: derived.outcome, summary: derived.summary })
          .eq('provider_call_id', ev.providerCallId)
        // Phase 7: same opt-out handling the Inngest classify path does.
        if (derived.outcome === 'opt_out' && agent?.org_id) {
          const e164 = externalNumber({ direction: ev.direction, from_e164: ev.fromE164, to_e164: ev.toE164 })
          if (e164) await recordOptOut(db, agent.org_id, e164).catch((e) => console.error('recordOptOut failed:', e))
        }
      }
    }
  }

  await db
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', eventId)

  return { status: 200, body: 'ok' }
}
