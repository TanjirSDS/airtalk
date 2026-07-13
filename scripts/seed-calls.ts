// Seeds 20 synthetic calls for Phase 3 acceptance: npm run seed-calls
// Deterministic and idempotent (upsert on provider_call_id = seed-conv-NN).
// Each non-failed call also carries a deterministic post-call analysis block
// (Phase 16 QA) so /qa and /analytics have real success/sentiment data to show.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { serviceClient } from '@airtalk/db'

// outcome, summary, transcript seed per call — mix chosen so "did this week book anything?"
// has a real answer (booked calls land in the most recent days).
const PLAN: [string, string][] = [
  ['booked', 'Booked a sink repair visit for Tuesday 10am.'],
  ['lead_captured', 'Collected name and number for a quote on water heater replacement.'],
  ['question_answered', 'Told caller the shop opens at 8am on Saturdays.'],
  ['booked', 'Scheduled annual boiler service for Friday afternoon.'],
  ['question_answered', 'Confirmed the business services the Riverside area.'],
  ['voicemail', 'Reached voicemail; left a callback message.'],
  ['lead_captured', 'Caller asked about bathroom remodel; details captured for follow-up.'],
  ['escalated', 'Emergency burst pipe — flagged for immediate human callback.'],
  ['question_answered', 'Explained hourly rates and call-out fee.'],
  ['booked', 'Booked drain cleaning for Wednesday morning.'],
  ['spam', 'Robocall about vehicle warranty; ended the call.'],
  ['failed', 'Call dropped before any exchange.'],
  ['question_answered', 'Gave directions to the shop and parking info.'],
  ['lead_captured', 'New landlord wants maintenance contract; contact details taken.'],
  ['voicemail', 'Reached voicemail; no message possible.'],
  ['booked', 'Rescheduled Thursday appointment to next Monday.'],
  ['escalated', 'Billing dispute — transferred to the office manager.'],
  ['question_answered', 'Confirmed the emergency line is available on weekends.'],
  ['failed', 'Silent call, no audio from caller.'],
  ['lead_captured', 'Quote request for kitchen re-pipe; photos to be emailed.'],
]

function transcriptFor(summary: string, durationSecs: number) {
  return [
    { role: 'agent', message: "Thanks for calling Joe's Plumbing, how can I help?", time_in_call_secs: 0 },
    { role: 'user', message: 'Hi, I need some help with a plumbing issue.', time_in_call_secs: 4 },
    { role: 'agent', message: summary, time_in_call_secs: Math.max(8, durationSecs - 10) },
  ]
}

// Deterministic post-call analysis (Phase 16 QA) in the stored CallAnalysis shape.
// A dropped ('failed') call produces no analysis; otherwise a single "Resolved"
// success criterion passes for calls the agent handled, plus a mapped sentiment.
const GOOD_OUTCOMES = new Set(['booked', 'lead_captured', 'question_answered'])
const NEGATIVE_OUTCOMES = new Set(['escalated', 'spam'])
function analysisFor(outcome: string) {
  if (outcome === 'failed') return null
  const resolved = GOOD_OUTCOMES.has(outcome)
  return {
    success: resolved,
    criteria: [
      {
        name: 'Resolved',
        result: resolved ? 'success' : 'failure',
        rationale: resolved ? "The agent handled the caller's request." : 'The call was not fully resolved by the agent.',
      },
    ],
    sentiment: resolved ? 'positive' : NEGATIVE_OUTCOMES.has(outcome) ? 'negative' : 'neutral',
  }
}

async function main() {
  const db = serviceClient()
  const { data: agent } = await db.from('agents').select('id').limit(1).maybeSingle()

  const rows = PLAN.map(([outcome, summary], i) => {
    // Spread over the last 13 days, most recent first; deterministic "random" times.
    const started = new Date()
    started.setUTCDate(started.getUTCDate() - (i * 2) % 13)
    started.setUTCHours(8 + ((i * 5) % 10), (i * 13) % 60, 0, 0)
    const failedish = outcome === 'failed'
    const duration = failedish ? 0 : outcome === 'voicemail' ? 22 : 45 + ((i * 37) % 240)
    const inbound = i % 4 !== 3
    const external = `+1555010${String(10 + i)}`
    return {
      agent_id: agent?.id ?? null,
      provider_call_id: `seed-conv-${String(i).padStart(2, '0')}`,
      direction: inbound ? 'inbound' : 'outbound',
      from_e164: inbound ? external : '+15551230000',
      to_e164: inbound ? '+15551230000' : external,
      started_at: started.toISOString(),
      duration_secs: duration,
      transcript: failedish ? [] : transcriptFor(summary, duration),
      recording_url: null,
      status: 'done',
      outcome,
      summary,
      analysis: analysisFor(outcome),
    }
  })

  const { error } = await db.from('calls').upsert(rows, { onConflict: 'provider_call_id' })
  if (error) throw new Error(error.message)
  console.log(`✅ Seeded ${rows.length} calls${agent ? '' : ' (no agent found — agent_id left null)'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
