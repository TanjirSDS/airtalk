import { serviceClient } from '@airtalk/db'
import Link from 'next/link'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import type { StoredAgentConfig } from '../../lib/types'

export const dynamic = 'force-dynamic' // hits Supabase; never prerender at build

export default async function AgentsPage() {
  const { data: agents, error } = await serviceClient()
    .from('agents')
    .select('id, name, status, created_at, config')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <Link href="/agents/new">
          <Button>New agent</Button>
        </Link>
      </div>

      {agents.length === 0 && (
        <p className="text-muted-foreground">No agents yet — create your first one.</p>
      )}

      <div className="space-y-3">
        {agents.map((a) => {
          const template = (a.config as StoredAgentConfig | null)?.template
          return (
            <Link key={a.id} href={`/agents/${a.id}`} className="block">
              <Card className="transition-colors hover:bg-accent">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>{a.name}</CardTitle>
                    <CardDescription>
                      Created {new Date(a.created_at).toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {template && <Badge variant="secondary">{template}</Badge>}
                    <Badge variant={a.status === 'active' ? 'default' : 'outline'}>{a.status}</Badge>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
