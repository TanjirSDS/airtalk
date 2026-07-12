// Phase 8 acceptance seed: a week of transcripts with 3 repeated unanswered
// questions (plus an escalation and a wrong-answer correction), so the Monday
// agent-learning run produces ≥3 evidenced suggestions. npm run seed-learning
// Deterministic and idempotent (upsert on provider_call_id = seed-learn-NN).
import { config } from 'dotenv'
config({ path: '.env.local' })

import { serviceClient } from '@airtalk/db'

type Turn = { role: 'agent' | 'user'; message: string; time_in_call_secs: number }

const OPEN: Turn[] = [
  { role: 'agent', message: "Thanks for calling Joe's Plumbing, I'm the AI assistant — how can I help?", time_in_call_secs: 0 },
]
function convo(...userAgentPairs: [string, string][]): Turn[] {
  const turns: Turn[] = [...OPEN]
  let t = 4
  for (const [user, agent] of userAgentPairs) {
    turns.push({ role: 'user', message: user, time_in_call_secs: t })
    turns.push({ role: 'agent', message: agent, time_in_call_secs: t + 6 })
    t += 14
  }
  return turns
}

const DONT_KNOW = "I'm sorry, I don't have that information. Can I take your name and number so someone can call you back?"

// Three questions the agent can't answer, each asked in multiple calls.
const GUTTERS = 'Do you guys also do gutter cleaning?'
const SUNDAY = 'Are you open on Sundays for emergencies?'
const FLUSH = 'How much does a water heater flush cost?'

const CALLS: { transcript: Turn[]; outcome: string }[] = [
  { outcome: 'escalated', transcript: convo([GUTTERS, DONT_KNOW], ['Hmm okay, my gutters are overflowing. Never mind then.', 'Sorry about that — can I take a message for the team?']) },
  { outcome: 'lead_captured', transcript: convo([GUTTERS, DONT_KNOW], ["Sure, it's Dana, 555-0141.", "Thanks Dana, I've noted that down — someone will call you back."]) },
  { outcome: 'escalated', transcript: convo([GUTTERS, DONT_KNOW], ["That's the third time I've asked you people about gutters.", 'I apologize — I will flag this for a human to call you right away.']) },
  { outcome: 'lead_captured', transcript: convo([SUNDAY, DONT_KNOW], ['My basement floods on weekends, I need to know!', "I understand — let me take your details and someone will confirm weekend availability."]) },
  { outcome: 'escalated', transcript: convo([SUNDAY, DONT_KNOW], ['Forget it, I need someone NOW, it is Sunday.', 'I am flagging this as an emergency for an immediate human callback.']) },
  { outcome: 'question_answered', transcript: convo([SUNDAY, DONT_KNOW], ['Okay, I will just call back Monday then.', 'Thanks for your patience — we open at 8am Monday.']) },
  { outcome: 'lead_captured', transcript: convo([FLUSH, DONT_KNOW], ["Alright, it's Sam, 555-0177, call me with a price.", 'Got it Sam — someone will call you with pricing.']) },
  { outcome: 'lead_captured', transcript: convo([FLUSH, DONT_KNOW], ['Every plumber lists this price online, you know.', 'I apologize — I will have someone call you with an exact quote.']) },
  // FAQ answered wrong: the caller corrects the agent with checkable info.
  { outcome: 'question_answered', transcript: convo(['Do you service the Riverside area?', "I'm sorry, I don't believe we cover Riverside."], ['Your own website says you DO service Riverside!', 'You are right, I apologize — we do service Riverside. How can I help?']) },
  // A failed call that ended before the agent could route it.
  { outcome: 'failed', transcript: convo(['Hello? Is this a robot? Hello?', 'Yes, I am an AI assistant for Joe\'s Plumbing — how can I help you today?']) },
  { outcome: 'booked', transcript: convo(['I need a drain cleaning this week.', 'I can help with that — what day works for you?'], ['Wednesday morning.', 'Booked for Wednesday at 9am. Anything else?']) },
  { outcome: 'question_answered', transcript: convo(['What are your Saturday hours?', 'We are open 9am to 1pm on Saturdays.']) },
]

async function main() {
  const db = serviceClient()
  const { data: agent } = await db
    .from('agents')
    .select('id, org_id')
    .not('org_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!agent) throw new Error('No agent with an org found — run seed-orgs first')

  const rows = CALLS.map((c, i) => {
    const started = new Date()
    started.setUTCDate(started.getUTCDate() - 1 - (i % 6)) // all within the last week
    started.setUTCHours(9 + (i % 8), (i * 17) % 60, 0, 0)
    const last = c.transcript[c.transcript.length - 1]
    return {
      agent_id: agent.id,
      org_id: agent.org_id,
      provider_call_id: `seed-learn-${String(i).padStart(2, '0')}`,
      direction: 'inbound',
      from_e164: `+1555020${String(10 + i)}`,
      to_e164: '+15551230000',
      started_at: started.toISOString(),
      duration_secs: last.time_in_call_secs + 8,
      transcript: c.transcript,
      status: 'done',
      outcome: c.outcome,
      summary: null,
    }
  })

  const { error } = await db.from('calls').upsert(rows, { onConflict: 'provider_call_id' })
  if (error) throw new Error(error.message)
  console.log(`✅ Seeded ${rows.length} learning calls for agent ${agent.id}`)
  console.log('Now trigger the agent-learning Inngest function (or wait for Monday 13:00 UTC).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
