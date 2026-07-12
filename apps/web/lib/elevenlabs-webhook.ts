import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'

// Rule 2: verify signature → insert webhook_events (UNIQUE event_id, skip on
// conflict = idempotent) → store raw payload → then process.
// Extracted from the route so the idempotency test can inject a fake db.
export async function handleElevenLabsWebhook(
  rawBody: string,
  signature: string | null,
  engine: VoiceEngine,
  db: SupabaseClient
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
      .select('id')
      .eq('provider_agent_id', payload.data.agent_id)
      .maybeSingle()
    await db.from('calls').upsert(
      {
        agent_id: agent?.id ?? null,
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
      },
      { onConflict: 'provider_call_id' }
    )
  }

  await db
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', eventId)

  return { status: 200, body: 'ok' }
}
