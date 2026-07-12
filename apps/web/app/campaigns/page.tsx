import Link from 'next/link'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  running: 'default',
  draft: 'outline',
  paused: 'secondary',
  done: 'secondary',
  killed: 'destructive',
}

export default async function CampaignsPage() {
  const db = await userClient()
  const { data: campaigns, error } = await db
    .from('campaigns')
    .select('id, name, status, created_at, campaign_contacts(count)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Link href="/campaigns/new">
          <Button>New campaign</Button>
        </Link>
      </div>

      <ul className="space-y-2">
        {(campaigns ?? []).map((c) => (
          <li key={c.id}>
            <Link
              href={`/campaigns/${c.id}`}
              className="flex items-center gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
            >
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {(c.campaign_contacts as unknown as { count: number }[])?.[0]?.count ?? 0} contacts
              </span>
              <span className="text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</span>
              <Badge variant={STATUS_VARIANT[c.status] ?? 'outline'}>{c.status}</Badge>
            </Link>
          </li>
        ))}
        {(campaigns ?? []).length === 0 && (
          <li className="text-sm text-muted-foreground">
            No campaigns yet. Outbound campaigns dial a contact list with one of your agents —
            inside legal calling hours, under a spend cap, with a kill switch.
          </li>
        )}
      </ul>
    </div>
  )
}
