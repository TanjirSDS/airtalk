import { notFound } from 'next/navigation'
import { Refresher } from '../../../components/refresher'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { estimatedSpendCents, type CallingWindow } from '../../../lib/campaign-math'
import { userClient } from '../../../lib/supabase-server'
import { killCampaignAction, pauseCampaignAction, startCampaignAction } from '../actions'

export const dynamic = 'force-dynamic'

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await userClient() // RLS: another org's campaign 404s
  const { data: campaign } = await db
    .from('campaigns')
    .select('*, agents(name)')
    .eq('id', id)
    .maybeSingle()
  if (!campaign) notFound()

  const { data: contacts } = await db
    .from('campaign_contacts')
    .select('status, calls(outcome, duration_secs, booking_ref)')
    .eq('campaign_id', id)

  const byStatus: Record<string, number> = {}
  let completedSecs = 0
  let voicemail = 0
  let booked = 0
  let reached = 0
  for (const c of contacts ?? []) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    const call = c.calls as unknown as {
      outcome: string | null
      duration_secs: number | null
      booking_ref: string | null
    } | null
    completedSecs += call?.duration_secs ?? 0
    if (call?.outcome === 'voicemail') voicemail++
    else if (c.status === 'done' && call?.outcome !== 'failed') reached++
    if (call?.outcome === 'booked' || call?.booking_ref) booked++
  }
  const total = contacts?.length ?? 0
  const settled = total - (byStatus.pending ?? 0) - (byStatus.calling ?? 0)
  const spendCents = estimatedSpendCents(completedSecs, byStatus.calling ?? 0)
  const window = campaign.calling_window as CallingWindow
  const active = campaign.status === 'running'

  return (
    <div className="space-y-6">
      {active && <Refresher seconds={10} />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">
            Agent: {(campaign.agents as unknown as { name: string })?.name} · Window:{' '}
            {hourLabel(window.startHour)}–{hourLabel(window.endHour)} recipient-local · Consent
            attested {new Date(campaign.consent_attested_at).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={campaign.status === 'killed' ? 'destructive' : 'default'}>{campaign.status}</Badge>
      </div>

      <div className="flex gap-2">
        {(campaign.status === 'draft' || campaign.status === 'paused') && (
          <form action={startCampaignAction.bind(null, id)}>
            <Button type="submit">{campaign.status === 'draft' ? 'Start campaign' : 'Resume'}</Button>
          </form>
        )}
        {active && (
          <form action={pauseCampaignAction.bind(null, id)}>
            <Button type="submit" variant="outline">
              Pause
            </Button>
          </form>
        )}
        {['draft', 'running', 'paused'].includes(campaign.status) && (
          <form action={killCampaignAction.bind(null, id)}>
            <Button type="submit" variant="destructive" size="lg">
              ■ Kill campaign
            </Button>
          </form>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Progress: {settled}/{total} contacts settled
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: total ? `${(settled / total) * 100}%` : '0%' }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Reached" value={reached} />
            <Stat label="Voicemail" value={voicemail} />
            <Stat label="Opted out" value={byStatus.opted_out ?? 0} />
            <Stat label="Booked" value={booked} />
            <Stat label="Pending" value={byStatus.pending ?? 0} />
            <Stat label="Calling now" value={byStatus.calling ?? 0} />
            <Stat label="Failed" value={byStatus.failed ?? 0} />
            <Stat
              label="Est. cost so far"
              value={`$${(spendCents / 100).toFixed(2)} / $${(campaign.spend_cap_cents / 100).toFixed(0)}`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Cost is a live estimate (completed minutes plus in-flight calls); billing truth comes
            from nightly reconciliation. Dialing stops automatically at the spend cap, and pause or
            kill takes effect within 30 seconds.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
