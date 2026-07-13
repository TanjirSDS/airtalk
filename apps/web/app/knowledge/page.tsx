import Link from 'next/link'
import { KnowledgeTable, type KbAgent, type KbDocRow } from '../../components/knowledge-table'
import { BookIcon } from '../../components/icons'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { makeEngine } from '../../lib/engine'
import { activeOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic' // hits Supabase + the provider (attachment state)

export default async function KnowledgePage() {
  const org = await activeOrg()

  // Plan gate (item 3): lower tiers see the upsell, not the feature.
  if (!org?.plan.kbEnabled) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center gap-4 bg-brand-soft px-8 py-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-brand">
              <BookIcon className="h-7 w-7" />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-brand">
                Growth feature
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">
                Give your agents a knowledge base
              </h1>
            </div>
          </div>
          <CardContent className="space-y-5 p-8 text-sm text-muted-foreground">
            <p>
              Upload FAQs, policies, price lists, or a link to your site, and attach them to any
              agent. Your agents answer from your own facts instead of guessing. Available on the
              Growth plan and higher.
            </p>
            <Link href="/billing" className="block">
              <Button size="lg" className="w-full">
                Upgrade plan
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const db = await userClient()
  const [{ data: docs }, { data: agentRows }] = await Promise.all([
    db
      .from('kb_documents')
      .select('id, name, source_type, created_by, created_at, provider_kb_id')
      .order('created_at', { ascending: false }),
    db.from('agents').select('id, name, provider_agent_id').order('created_at', { ascending: true }),
  ])

  // Attachment lives at the provider (not in our DB), so read it there — the
  // source of truth. Agent count is plan-capped small, so N GETs is fine.
  // ponytail: add a kb_attachments cache table if orgs ever run many agents.
  const engine = makeEngine()
  const provisioned = (agentRows ?? []).filter((a) => a.provider_agent_id)
  const attachLists = await Promise.all(
    provisioned.map((a) =>
      engine
        .listKnowledge(a.provider_agent_id)
        .then((ks) => ({ agentId: a.id, ids: new Set(ks.map((k) => k.knowledgeId)) }))
        .catch(() => ({ agentId: a.id, ids: new Set<string>() }))
    )
  )

  const rows: KbDocRow[] = (docs ?? []).map((d) => {
    const attachedAgentIds = attachLists.filter((a) => a.ids.has(d.provider_kb_id)).map((a) => a.agentId)
    return {
      id: d.id,
      name: d.name,
      sourceType: d.source_type,
      createdBy: d.created_by,
      createdAt: d.created_at,
      usedBy: attachedAgentIds.length,
      attachedAgentIds,
    }
  })
  const agents: KbAgent[] = (agentRows ?? []).map((a) => ({ id: a.id, name: a.name }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documents your agents can draw on. Add a source, then attach it to the agents that need it.
        </p>
      </div>
      <KnowledgeTable docs={rows} agents={agents} />
    </div>
  )
}
