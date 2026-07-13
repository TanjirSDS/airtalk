import { getEnv } from '@airtalk/db'
import { normalizeStoredConfigSafe } from '@airtalk/engine/templates'
import { AgentsTable, type AgentRow } from '../../components/agents-table'
import { makeEngine } from '../../lib/engine'
import { activeOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic' // hits Supabase + the provider voices API

export default async function AgentsPage() {
  const db = await userClient()
  const [{ data: agents, error }, org] = await Promise.all([
    db
      .from('agents')
      .select('id, name, agent_type, config, updated_at, updated_by, created_at')
      .order('created_at', { ascending: false }),
    activeOrg(),
  ])
  if (error) throw new Error(error.message)

  // Resolve voice names once per request (not per row) and attached numbers.
  const engine = makeEngine()
  const [voices, { data: numbers }] = await Promise.all([
    engine.listVoices().catch(() => []),
    db.from('phone_numbers').select('agent_id, e164'),
  ])
  const voiceName = new Map(voices.map((v) => [v.voiceId, v.name]))
  const phoneFor = new Map((numbers ?? []).map((n) => [n.agent_id, n.e164]))

  const rows: AgentRow[] = (agents ?? []).map((a) => {
    const norm = normalizeStoredConfigSafe(a.config)
    const cfgVoice = norm?.agentConfig.voiceId ?? ''
    return {
      id: a.id,
      name: a.name,
      agentType: a.agent_type ?? 'single',
      voiceName: voiceName.get(cfgVoice) ?? (cfgVoice ? cfgVoice : null),
      phone: phoneFor.get(a.id) ?? null,
      updatedBy: a.updated_by ?? null,
      updatedAt: a.updated_at ?? a.created_at,
      exportConfig: {
        agentType: a.agent_type ?? 'single',
        template: norm?.template ?? null,
        agentConfig: norm?.agentConfig ?? a.config,
      },
    }
  })

  const maxAgents = org?.plan.maxAgents ?? 0
  const atLimit = !!org && rows.length >= maxAgents

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your AI voice agents. Create one from a template, a blank prompt, or a description.
        </p>
      </div>

      <AgentsTable
        agents={rows}
        voices={voices.map((v) => ({ voiceId: v.voiceId, name: v.name }))}
        defaultVoiceId={voices[0]?.voiceId ?? ''}
        openaiEnabled={!!getEnv().OPENAI_API_KEY}
        atLimit={atLimit}
        planName={org?.plan.name ?? ''}
        maxAgents={maxAgents}
      />
    </div>
  )
}
