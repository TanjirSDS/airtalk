import { AgentWizard } from '../../../components/agent-wizard'
import { makeEngine } from '../../../lib/engine'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic' // hits the provider voices API per request

export default async function NewAgentPage() {
  // Plan gate (Phase 4): max_agents. createAgentAction re-checks — this is just UX.
  const org = await activeOrg()
  if (org) {
    const { count } = await (await userClient())
      .from('agents')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.orgId)
    if ((count ?? 0) >= org.plan.maxAgents) {
      return (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">New agent</h1>
          <p className="text-muted-foreground">
            Your {org.plan.name} plan includes {org.plan.maxAgents} agent
            {org.plan.maxAgents === 1 ? '' : 's'} and you&apos;ve reached that limit. Upgrade your
            plan to add more.
          </p>
        </div>
      )
    }
  }

  const voices = await makeEngine().listVoices()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New agent</h1>
      <AgentWizard voices={voices} />
    </div>
  )
}
