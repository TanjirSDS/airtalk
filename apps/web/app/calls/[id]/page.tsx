import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CallPlayer } from '../../../components/call-player'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { formatDuration } from '../../../lib/call-filters'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: call, error } = await (await userClient())
    .from('calls')
    .select('*, agents(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!call) notFound()

  const meta: [string, string][] = [
    ['Agent', (call.agents as { name: string } | null)?.name ?? '—'],
    ['Direction', call.direction ?? '—'],
    ['From', call.from_e164 ?? '—'],
    ['To', call.to_e164 ?? '—'],
    ['Started', call.started_at ? new Date(call.started_at).toLocaleString() : '—'],
    ['Duration', formatDuration(call.duration_secs)],
    ['Status', call.status ?? '—'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Call detail</h1>
        <Link href="/calls" className="text-sm text-muted-foreground hover:text-foreground">
          ← All calls
        </Link>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Summary</CardTitle>
          {call.outcome && <Badge>{call.outcome.replace('_', ' ')}</Badge>}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={call.summary ? '' : 'text-muted-foreground'}>
            {call.summary ?? 'No summary extracted for this call.'}
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {meta.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recording & transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <CallPlayer
            src={call.recording_url ?? `/api/calls/${call.id}/audio`}
            transcript={Array.isArray(call.transcript) ? call.transcript : []}
          />
        </CardContent>
      </Card>
    </div>
  )
}
