import { normalizeStoredConfigSafe } from '@airtalk/engine/templates'
import { notFound } from 'next/navigation'
import { AgentBuilder, type BuilderConfig } from '../../../components/agent-builder'
import { CalcomConnectForm } from '../../../components/calcom-connect-form'
import { AgentKbSection, type AgentKbDoc } from '../../../components/agent-kb-section'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../../components/ui/accordion'
import { includedRateCentsPerMin, OVERAGE_CENTS_PER_MIN } from '../../../lib/billing-math'
import { makeEngine } from '../../../lib/engine'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'
import type { VersionRow } from '../../../components/versions-sheet'

export const dynamic = 'force-dynamic'

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await userClient() // RLS: another org's agent id 404s
  const { data: agent } = await db.from('agents').select('*').eq('id', id).maybeSingle()
  if (!agent) notFound()

  const org = await activeOrg()
  const kbEnabled = org?.plan.kbEnabled ?? false

  const { data: versions } = await db
    .from('agent_config_versions')
    .select('version, created_at, config, label')
    .eq('agent_id', id)
    .order('version', { ascending: false })

  const engine = makeEngine()
  const voices = await engine.listVoices().catch(() => [])

  const stored = normalizeStoredConfigSafe(agent.config)
  if (!stored) {
    return (
      <p className="text-sm text-muted-foreground">
        This agent&apos;s configuration is unreadable. Run migrate-agent-config or recreate it.
      </p>
    )
  }

  // Effective $/min (item 1): plan price spread over included minutes, plus the
  // flat overage rate. plans is authenticated-readable under RLS.
  const { data: plan } = org
    ? await db.from('plans').select('price_cents, included_minutes').eq('id', org.plan.id).maybeSingle()
    : { data: null }
  const rate = {
    includedCentsPerMin: plan ? includedRateCentsPerMin(plan.price_cents, plan.included_minutes) : 0,
    overageCentsPerMin: OVERAGE_CENTS_PER_MIN,
    planName: org?.plan.name ?? '—',
  }

  // Cal.com booking (Phase 7) → the rail's Functions section.
  const { data: orgRow } = await db.from('orgs').select('calcom_api_key, calcom_event_type_id').maybeSingle()
  const calcomConnected = !!orgRow?.calcom_api_key && !!orgRow?.calcom_event_type_id

  // Knowledge base → the rail's Knowledge Base section. Docs are org-scoped
  // (kb_documents); attachment state comes from the provider (source of truth).
  let kbDocs: AgentKbDoc[] = []
  if (kbEnabled) {
    const [{ data: docRows }, attached] = await Promise.all([
      db.from('kb_documents').select('id, name, source_type, provider_kb_id').order('created_at', { ascending: false }),
      agent.provider_agent_id
        ? engine
            .listKnowledge(agent.provider_agent_id)
            .then((ks) => new Set(ks.map((k) => k.knowledgeId)))
            .catch(() => new Set<string>())
        : Promise.resolve(new Set<string>()),
    ])
    kbDocs = (docRows ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      sourceType: d.source_type,
      attached: attached.has(d.provider_kb_id),
    }))
  }

  const showFunctions = stored.template === 'booking'
  const isCustom = agent.agent_type === 'custom_llm'
  // Right rail reduced for custom-LLM agents (item 8).
  const rail =
    !isCustom && (showFunctions || kbEnabled) ? (
      <Accordion type="multiple" defaultValue={['functions', 'kb']} className="rounded-xl border bg-card px-4">
        {showFunctions && (
          <AccordionItem value="functions">
            <AccordionTrigger>Functions</AccordionTrigger>
            <AccordionContent>
              <p className="mb-3 text-xs text-muted-foreground">
                Connect a Cal.com calendar and this agent books confirmed appointments during the
                call instead of taking a message.
              </p>
              <CalcomConnectForm
                agentId={id}
                connected={calcomConnected}
                eventTypeId={orgRow?.calcom_event_type_id ?? null}
              />
            </AccordionContent>
          </AccordionItem>
        )}
        {kbEnabled && (
          <AccordionItem value="kb">
            <AccordionTrigger>Knowledge Base</AccordionTrigger>
            <AccordionContent>
              <AgentKbSection agentId={id} docs={kbDocs} />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    ) : null

  const config: BuilderConfig = {
    name: stored.agentConfig.name,
    systemPrompt: stored.agentConfig.systemPrompt,
    firstMessage: stored.agentConfig.firstMessage,
    voiceId: stored.agentConfig.voiceId,
    llm: stored.agentConfig.llm,
    language: stored.agentConfig.language,
    customLlm: stored.agentConfig.customLlm,
    // Phase 12 settings accordion.
    speech: stored.agentConfig.speech,
    transcription: stored.agentConfig.transcription,
    call: stored.agentConfig.call,
    analysis: stored.agentConfig.analysis,
    widget: stored.agentConfig.widget,
  }

  const versionRows: VersionRow[] = (versions ?? []).map((v) => ({
    version: v.version,
    createdAt: v.created_at,
    label: (v as { label: string | null }).label ?? null,
    prompt: normalizeStoredConfigSafe(v.config)?.agentConfig.systemPrompt ?? '',
  }))
  const currentVersion = versionRows[0]?.version ?? 1

  return (
    <AgentBuilder
      key={currentVersion}
      agentId={id}
      providerAgentId={agent.provider_agent_id}
      status={agent.status}
      agentType={agent.agent_type ?? 'single'}
      config={config}
      voices={voices}
      embed={agent.provider_agent_id ? engine.testWidgetEmbed(agent.provider_agent_id) : null}
      shareToken={agent.share_token ?? null}
      versions={versionRows}
      rate={rate}
      rail={rail}
    />
  )
}
