import {
  suggestionTitle,
  type SuggestionPayload,
  type SuggestionType,
} from '@airtalk/engine/templates'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '../../../../components/ui/badge'
import { Button } from '../../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { Input } from '../../../../components/ui/input'
import { activeOrg } from '../../../../lib/org'
import { userClient } from '../../../../lib/supabase-server'
import { applySuggestionsAction, dismissSuggestionAction } from '../../actions'

export const dynamic = 'force-dynamic'

interface SuggestionRow {
  id: string
  week: string
  type: SuggestionType
  suggestion: SuggestionPayload
  evidence: { callId: string; quote: string }[]
  status: 'pending' | 'applied' | 'dismissed'
  applied_version: number | null
  created_at: string
}

// Phase 8 review UI: weekly suggestions with evidence → Apply / Dismiss.
export default async function LearningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await userClient() // RLS: another org's agent id 404s
  const { data: agent } = await db.from('agents').select('id, name, config').eq('id', id).maybeSingle()
  if (!agent) notFound()
  const org = await activeOrg()

  // Plan gate (item 5): lower tiers see the upsell, not the feature.
  if (!org?.plan.adaptiveEnabled) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-2xl font-semibold">Agent learning</h1>
        <Card>
          <CardHeader>
            <CardTitle>Your agent could be learning from every call</CardTitle>
            <CardDescription>Adaptive learning is a Pro feature.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Every week, Pro agents review their own calls and draft improvements: FAQs for
              questions they couldn&apos;t answer, fixes for answers that went wrong, and rules for
              when to hand off to a human — each backed by quotes from real calls. You review and
              apply with one click.
            </p>
            <Button>
              <Link href="/billing">Upgrade to Pro →</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data } = await db
    .from('agent_suggestions')
    .select('*')
    .eq('agent_id', id)
    .order('created_at', { ascending: false })
  const suggestions = (data ?? []) as SuggestionRow[]
  const pending = suggestions.filter((s) => s.status === 'pending')
  const appliable = pending.filter((s) => s.type !== 'kb_gap')
  const resolved = suggestions.filter((s) => s.status !== 'pending').slice(0, 20)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{agent.name} — learning</h1>
          <p className="text-sm text-muted-foreground">
            Drafted from last week&apos;s calls. Applying updates the live agent and records a new
            config version, so anything can be rolled back.
          </p>
        </div>
        <Link className="text-sm underline" href={`/agents/${id}`}>
          Back to agent
        </Link>
      </div>

      {pending.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No pending suggestions. New ones arrive every Monday once your agent has a week of
            calls to learn from.
          </CardContent>
        </Card>
      )}

      {appliable.length > 1 && (
        <form action={applySuggestionsAction.bind(null, id)}>
          {appliable.map((s) => (
            <input key={s.id} type="hidden" name="id" value={s.id} />
          ))}
          <Button type="submit">Apply all {appliable.length} suggestions</Button>
        </form>
      )}

      {pending.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{s.type.replace('_', ' ')}</Badge>
              {typeof s.suggestion.frequency === 'number' && s.suggestion.frequency > 1 && (
                <Badge variant="outline">asked in {s.suggestion.frequency} calls</Badge>
              )}
            </div>
            <CardTitle className="text-base">{suggestionTitle(s.type, s.suggestion)}</CardTitle>
            {s.suggestion.rationale && <CardDescription>{s.suggestion.rationale}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            {s.evidence.length > 0 && (
              <ul className="space-y-1">
                {s.evidence.map((e, i) => (
                  <li key={i} className="border-l-2 pl-3 text-sm text-muted-foreground">
                    “{e.quote}”{' '}
                    <Link className="underline" href={`/calls/${e.callId}`}>
                      view call
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {s.type === 'kb_gap' ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm text-muted-foreground">
                  Callers wanted this but your business facts don&apos;t cover it — add it to the
                  FAQs or knowledge base, then dismiss.
                </p>
                <form action={dismissSuggestionAction.bind(null, id, s.id)}>
                  <Button type="submit" variant="outline" size="sm">
                    Dismiss
                  </Button>
                </form>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <form action={applySuggestionsAction.bind(null, id)} className="flex flex-1 items-end gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  {s.type === 'faq_addition' && (
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground">Answer (edit before applying)</label>
                      <Input name="answer" defaultValue={s.suggestion.a ?? ''} required />
                    </div>
                  )}
                  <Button type="submit" size="sm">
                    Apply
                  </Button>
                </form>
                <form action={dismissSuggestionAction.bind(null, id, s.id)}>
                  <Button type="submit" variant="outline" size="sm">
                    Dismiss
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {resolved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {resolved.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <Badge variant={s.status === 'applied' ? 'default' : 'outline'}>{s.status}</Badge>
                  <span className="flex-1 truncate text-muted-foreground">
                    {suggestionTitle(s.type, s.suggestion)}
                  </span>
                  {s.applied_version && <span className="text-muted-foreground">v{s.applied_version}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
