import { NumbersTable, type NumberRow, type NumbersAgent } from '../../components/numbers-table'
import { activeOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function NumbersPage() {
  const db = await userClient()
  const [{ data: numberRows }, { data: agentRows }, org] = await Promise.all([
    db
      .from('phone_numbers')
      .select('id, e164, twilio_sid, status, agent_id, created_at')
      .order('created_at', { ascending: false }),
    db.from('agents').select('id, name').order('created_at', { ascending: true }),
    activeOrg(),
  ])

  const numbers: NumberRow[] = (numberRows ?? []).map((n) => ({
    id: n.id,
    e164: n.e164,
    // No Twilio SID ⇒ it came in via SIP (Phase 13 derives provider from the SID).
    provider: n.twilio_sid ? 'twilio' : 'sip',
    status: n.status,
    agentId: n.agent_id ?? null,
    createdAt: n.created_at ?? null,
  }))
  const agents: NumbersAgent[] = (agentRows ?? []).map((a) => ({ id: a.id, name: a.name }))

  const maxNumbers = org?.plan.maxNumbers ?? 0
  const activeCount = numbers.filter((n) => n.status !== 'released').length
  const atLimit = !!org && activeCount >= maxNumbers

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Phone Numbers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Numbers your agents answer on. Buy a US number or connect your own SIP trunk, then assign
          an agent. {activeCount} of {maxNumbers} used.
        </p>
      </div>
      <NumbersTable numbers={numbers} agents={agents} atLimit={atLimit} maxNumbers={maxNumbers} />
    </div>
  )
}
