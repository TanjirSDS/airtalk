import { CampaignWizard } from '../../../components/campaign-wizard'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function NewCampaignPage() {
  const db = await userClient()
  const { data: agents } = await db.from('agents').select('id, name').eq('status', 'active').order('name')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New campaign</h1>
      {agents?.length ? (
        <CampaignWizard agents={agents} />
      ) : (
        <p className="text-sm text-muted-foreground">
          You need an active agent before you can run an outbound campaign.
        </p>
      )}
    </div>
  )
}
