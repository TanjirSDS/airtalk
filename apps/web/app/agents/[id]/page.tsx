import type { KnowledgeSource } from '@airtalk/engine'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AgentEditForm } from '../../../components/agent-edit-form'
import { CalcomConnectForm } from '../../../components/calcom-connect-form'
import { TestWidget } from '../../../components/test-widget'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { makeEngine } from '../../../lib/engine'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'
import type { StoredAgentConfig } from '../../../lib/types'
import { addKnowledgeAction, removeKnowledgeAction, rollbackAgentAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await userClient() // RLS: another org's agent id 404s
  const { data: agent } = await db.from('agents').select('*').eq('id', id).maybeSingle()
  if (!agent) notFound()

  // Plan gate (Phase 4): knowledge base is a growth+ feature.
  const kbEnabled = (await activeOrg())?.plan.kbEnabled ?? false

  const { data: versions } = await db
    .from('agent_config_versions')
    .select('version, created_at, config')
    .eq('agent_id', id)
    .order('version', { ascending: false })

  const engine = makeEngine()
  const voices = await engine.listVoices().catch(() => [])
  let knowledge: KnowledgeSource[] = []
  let knowledgeError: string | null = null
  if (kbEnabled && agent.provider_agent_id) {
    try {
      knowledge = await engine.listKnowledge(agent.provider_agent_id)
    } catch (e) {
      knowledgeError = e instanceof Error ? e.message : String(e)
    }
  }

  const stored = agent.config as StoredAgentConfig | null
  const editable = !!stored?.profile // bootstrap-era agents predate the wizard shape

  // Phase 7: booking agents can book real Cal.com slots once a calendar is connected.
  const { data: orgRow } = await db
    .from('orgs')
    .select('calcom_api_key, calcom_event_type_id')
    .maybeSingle()
  const calcomConnected = !!orgRow?.calcom_api_key && !!orgRow?.calcom_event_type_id

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{agent.name}</h1>
        <div className="flex items-center gap-2">
          <Link className="text-sm underline" href={`/agents/${id}/learning`}>
            Learning
          </Link>
          {stored?.template && <Badge variant="secondary">{stored.template}</Badge>}
          <Badge>{agent.status}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test your agent</CardTitle>
          <CardDescription>Talk to it right here in the browser.</CardDescription>
        </CardHeader>
        <CardContent>
          {agent.provider_agent_id ? (
            <TestWidget embed={engine.testWidgetEmbed(agent.provider_agent_id)} />
          ) : (
            <p className="text-sm text-muted-foreground">Agent has no provider id yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>
            Saving re-generates the prompt from the template and pushes it to the provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {editable ? (
            <>
              <AgentEditForm
                agentId={id}
                template={stored!.template}
                initialProfile={stored!.profile}
                voices={voices}
              />
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Current generated prompt
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {stored!.agentConfig.systemPrompt}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This agent was created before the wizard existed and has no editable business
              profile. Recreate it from “New agent”.
            </p>
          )}
        </CardContent>
      </Card>

      {stored?.template === 'booking' && (
        <Card>
          <CardHeader>
            <CardTitle>Calendar booking (Cal.com)</CardTitle>
            <CardDescription>
              Connect a Cal.com calendar and this agent checks real availability and books
              confirmed appointments during the call, instead of taking a message.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CalcomConnectForm
              agentId={id}
              connected={calcomConnected}
              eventTypeId={orgRow?.calcom_event_type_id ?? null}
            />
          </CardContent>
        </Card>
      )}

      {kbEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>Knowledge base</CardTitle>
            <CardDescription>
              Documents and pages the agent can answer questions from.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {knowledgeError && <p className="text-sm text-destructive">{knowledgeError}</p>}
            <ul className="space-y-2">
              {knowledge.map((k) => (
                <li key={k.knowledgeId} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <Badge variant="outline">{k.type}</Badge>
                  <span className="flex-1 truncate">{k.name}</span>
                  <form action={removeKnowledgeAction.bind(null, id, k.knowledgeId)}>
                    <Button type="submit" variant="ghost" size="sm">
                      ✕
                    </Button>
                  </form>
                </li>
              ))}
              {knowledge.length === 0 && !knowledgeError && (
                <li className="text-sm text-muted-foreground">No sources attached yet.</li>
              )}
            </ul>
            <form action={addKnowledgeAction.bind(null, id)} className="flex gap-2">
              <Input name="url" type="url" placeholder="https://your-site.com/faq" required />
              <Button type="submit" variant="outline">
                Add URL
              </Button>
            </form>
            <form action={addKnowledgeAction.bind(null, id)} className="flex gap-2">
              <Input name="file" type="file" required />
              <Button type="submit" variant="outline">
                Upload file
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
          <CardDescription>
            Rolling back re-applies that version to the provider and records it as a new version.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(versions ?? []).map((v, i) => (
              <li key={v.version} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                <Badge variant={i === 0 ? 'default' : 'outline'}>v{v.version}</Badge>
                <span className="flex-1 text-muted-foreground">
                  {new Date(v.created_at).toLocaleString()}
                  {i === 0 && ' — current'}
                </span>
                {i > 0 && (
                  <form action={rollbackAgentAction.bind(null, id, v.version)}>
                    <Button type="submit" variant="outline" size="sm">
                      Roll back to v{v.version}
                    </Button>
                  </form>
                )}
              </li>
            ))}
            {(versions ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No versions recorded yet.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
