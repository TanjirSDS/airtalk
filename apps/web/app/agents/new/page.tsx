import { AgentWizard } from '../../../components/agent-wizard'
import { makeEngine } from '../../../lib/engine'

export const dynamic = 'force-dynamic' // hits the provider voices API per request

export default async function NewAgentPage() {
  const voices = await makeEngine().listVoices()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New agent</h1>
      <AgentWizard voices={voices} />
    </div>
  )
}
