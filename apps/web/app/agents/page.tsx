import Link from 'next/link'
import { userClient } from '../../lib/supabase-server'
import { AgentIcon, ChevronRightIcon } from '../../components/icons'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import type { StoredAgentConfig } from '../../lib/types'

export const dynamic = 'force-dynamic' // hits Supabase; never prerender at build

export default async function AgentsPage() {
  const { data: agents, error } = await (await userClient())
    .from('agents')
    .select('id, name, status, created_at, config')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your AI voice agents and the templates they run on.
          </p>
        </div>
        <Link href="/agents/new">
          <Button>New agent</Button>
        </Link>
      </div>

      {agents.length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-soft text-brand">
            <AgentIcon className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">
            No agents yet. Create your first one to start answering calls.
          </p>
          <Link href="/agents/new">
            <Button>New agent</Button>
          </Link>
        </Card>
      )}

      <div className="space-y-3">
        {agents.map((a) => {
          const template = (a.config as StoredAgentConfig | null)?.template
          const live = a.status === 'active'
          return (
            <Link key={a.id} href={`/agents/${a.id}`} className="block">
              <Card className="flex items-center gap-4 p-4 transition-all hover:border-brand/40 hover:shadow-pop">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <AgentIcon />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(a.created_at).toLocaleDateString()}
                  </p>
                </div>
                {template && <Badge variant="secondary">{template}</Badge>}
                <Badge variant={live ? 'live' : 'outline'} dot={live}>
                  {a.status}
                </Badge>
                <ChevronRightIcon className="h-5 w-5 text-muted-foreground" />
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
