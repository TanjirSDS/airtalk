import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  AgentConfig,
  AgentTool,
  CallAnalysis,
  CallEvent,
  KnowledgeSource,
  ProviderCall,
  Voice,
  VoiceEngine,
  WebhookRequest,
} from './types'

/** Human name → provider identifier (data_collection key / evaluation criterion id). */
function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  )
}

// Endpoint paths verified against https://elevenlabs.io/docs/eleven-agents/api-reference
// on 2026-07-12. Payload details marked VERIFY below must be confirmed against a
// captured live webhook/response in Phase 1 (rule 6).

const BASE = 'https://api.elevenlabs.io'

export interface ElevenLabsEngineOpts {
  apiKey: string
  webhookSecret: string
  /** Needed by importNumber: ElevenLabs' native Twilio integration takes the creds. */
  twilioAccountSid: string
  twilioAuthToken: string
}

export class ElevenLabsEngine implements VoiceEngine {
  constructor(private opts: ElevenLabsEngineOpts) {}

  private async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'xi-api-key': this.opts.apiKey,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      throw new Error(`ElevenLabs ${method} ${path} → ${res.status}: ${await res.text()}`)
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  }

  /**
   * Maps our AgentConfig onto ElevenLabs' nested conversation_config +
   * platform_settings. PATCH deep-merges top-level keys, so partial configs only
   * touch the fields they carry. Phase 12 field paths verified against the
   * Create/Update-agent OpenAPI on 2026-07-13:
   *   conversation_config.tts.{stability(0-1,def .5)|similarity_boost(0-1,def .8)|speed(def 1)}
   *   conversation_config.asr.keywords: string[]  (ASR bias words)
   *   conversation_config.conversation.max_duration_seconds: int (def 600)
   *   conversation_config.turn.silence_end_call_timeout: number sec (def -1 = off)
   *   platform_settings.data_collection: map<identifier,{type,description}>
   *   platform_settings.evaluation.criteria: [{id,name,type:'prompt',conversation_goal_prompt}]
   *   platform_settings.auth.enable_auth: bool (false = public)
   * MCP (agent.prompt.mcp_server_ids) takes PRE-REGISTERED server ids, not URLs,
   * so it isn't exposed here — see the Phase 12 log for the verdict.
   */
  private toProviderConfig(cfg: Partial<AgentConfig>) {
    // Custom LLM (verified 2026-07-13): prompt.llm='custom-llm' + prompt.custom_llm
    // {url, model_id?, api_key:{secret_id}} — the key is a workspace-secret ref,
    // never a plain string. https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm
    const custom = cfg.customLlm
    const conversation_config: Record<string, unknown> = {
      agent: {
        // empty string ⇒ user speaks first (agent waits); verified against
        // https://elevenlabs.io/docs/api-reference/agents/create
        ...(cfg.firstMessage !== undefined && { first_message: cfg.firstMessage }),
        language: cfg.language ?? 'en',
        prompt: {
          ...(cfg.systemPrompt !== undefined && { prompt: cfg.systemPrompt }),
          ...(custom
            ? {
                llm: 'custom-llm',
                custom_llm: {
                  url: custom.url,
                  ...(custom.modelId && { model_id: custom.modelId }),
                  ...(custom.apiKeySecretId && { api_key: { secret_id: custom.apiKeySecretId } }),
                },
              }
            : cfg.llm !== undefined && { llm: cfg.llm }),
        },
      },
    }

    // tts carries the voice AND the speech tuning — build it once so neither clobbers the other.
    const tts: Record<string, number | string> = {}
    if (cfg.voiceId !== undefined) tts.voice_id = cfg.voiceId
    if (cfg.speech?.stability !== undefined) tts.stability = cfg.speech.stability
    if (cfg.speech?.similarityBoost !== undefined) tts.similarity_boost = cfg.speech.similarityBoost
    if (cfg.speech?.speed !== undefined) tts.speed = cfg.speech.speed
    if (Object.keys(tts).length) conversation_config.tts = tts

    if (cfg.transcription?.keywords) conversation_config.asr = { keywords: cfg.transcription.keywords }
    if (cfg.call?.maxDurationSecs !== undefined)
      conversation_config.conversation = { max_duration_seconds: cfg.call.maxDurationSecs }
    if (cfg.call?.endOnSilenceSecs !== undefined)
      conversation_config.turn = { silence_end_call_timeout: cfg.call.endOnSilenceSecs }

    const platform_settings: Record<string, unknown> = {}
    if (cfg.analysis) {
      // data_collection is keyed by identifier; our human name slugifies to the key
      // and reappears as data_collection_id in the post-call results.
      platform_settings.data_collection = Object.fromEntries(
        cfg.analysis.dataCollection
          .slice(0, 30)
          .map((f) => [slugify(f.name), { type: f.type, description: f.description }])
      )
      platform_settings.evaluation = {
        criteria: cfg.analysis.successCriteria.slice(0, 30).map((c) => ({
          id: slugify(c.name),
          name: c.name,
          type: 'prompt',
          conversation_goal_prompt: c.prompt,
        })),
      }
    }
    if (cfg.widget?.public !== undefined) platform_settings.auth = { enable_auth: !cfg.widget.public }

    return {
      ...(cfg.name !== undefined && { name: cfg.name }),
      conversation_config,
      ...(Object.keys(platform_settings).length && { platform_settings }),
    }
  }

  async createAgent(cfg: AgentConfig) {
    const res = await this.req('POST', '/v1/convai/agents/create', this.toProviderConfig(cfg))
    return { providerAgentId: res.agent_id as string }
  }

  async updateAgent(providerAgentId: string, cfg: Partial<AgentConfig>) {
    await this.req('PATCH', `/v1/convai/agents/${providerAgentId}`, this.toProviderConfig(cfg))
  }

  async deleteAgent(providerAgentId: string) {
    await this.req('DELETE', `/v1/convai/agents/${providerAgentId}`)
  }

  // ElevenLabs wants the Twilio *account* creds, not the number SID — twilioSid is
  // unused here but stays in the interface (other providers may need it).
  async importNumber(_twilioSid: string, e164: string) {
    const res = await this.req('POST', '/v1/convai/phone-numbers', {
      provider: 'twilio',
      phone_number: e164,
      label: e164,
      sid: this.opts.twilioAccountSid,
      token: this.opts.twilioAuthToken,
    })
    return { providerNumberId: res.phone_number_id as string }
  }

  async attachNumber(providerNumberId: string, providerAgentId: string) {
    await this.req('PATCH', `/v1/convai/phone-numbers/${providerNumberId}`, {
      agent_id: providerAgentId,
    })
  }

  /** agent_id is nullable in UpdatePhoneNumberRequest — null unassigns (verified against docs 2026-07-12). */
  async detachNumber(providerNumberId: string) {
    await this.req('PATCH', `/v1/convai/phone-numbers/${providerNumberId}`, { agent_id: null })
  }

  /** The outbound endpoints need the provider phone-number id; look it up by assigned agent. */
  private async phoneNumberIdFor(providerAgentId: string): Promise<string> {
    const numbers = await this.req<any[]>('GET', '/v1/convai/phone-numbers')
    const match = numbers.find(
      (n) => n.assigned_agent?.agent_id === providerAgentId || n.agent_id === providerAgentId
    )
    if (!match) throw new Error(`No phone number attached to agent ${providerAgentId}`)
    return match.phone_number_id as string
  }

  async startOutboundCall(providerAgentId: string, toE164: string, vars?: Record<string, string>) {
    const res = await this.req('POST', '/v1/convai/twilio/outbound-call', {
      agent_id: providerAgentId,
      agent_phone_number_id: await this.phoneNumberIdFor(providerAgentId),
      to_number: toE164,
      ...(vars && { conversation_initiation_client_data: { dynamic_variables: vars } }),
    })
    // conversation_id is the id post-call webhooks reference — that is our providerCallId.
    return { providerCallId: res.conversation_id as string }
  }

  async startBatch(
    providerAgentId: string,
    contacts: { e164: string; vars?: Record<string, string> }[]
  ) {
    const res = await this.req('POST', '/v1/convai/batch-calling/submit', {
      call_name: `batch-${contacts.length}-contacts`,
      agent_id: providerAgentId,
      agent_phone_number_id: await this.phoneNumberIdFor(providerAgentId),
      recipients: contacts.map((c) => ({
        phone_number: c.e164,
        ...(c.vars && { conversation_initiation_client_data: { dynamic_variables: c.vars } }),
      })),
    })
    return { batchId: res.id as string }
  }

  async addKnowledge(providerAgentId: string, source: { url?: string; file?: { name: string; data: Blob } }) {
    let doc: any
    if (source.url) {
      doc = await this.req('POST', '/v1/convai/knowledge-base/url', { url: source.url })
    } else if (source.file) {
      const form = new FormData()
      form.append('file', source.file.data, source.file.name)
      const res = await fetch(`${BASE}/v1/convai/knowledge-base/file`, {
        method: 'POST',
        headers: { 'xi-api-key': this.opts.apiKey },
        body: form,
      })
      if (!res.ok) throw new Error(`ElevenLabs KB file upload → ${res.status}: ${await res.text()}`)
      doc = await res.json()
    } else {
      throw new Error('addKnowledge needs url or file')
    }

    // Attach to prompt.knowledge_base — entry shape {type,id,name} verified against
    // KnowledgeBaseLocator docs 2026-07-12 (usage_mode optional, defaults 'auto').
    const agent = await this.req('GET', `/v1/convai/agents/${providerAgentId}`)
    const existing = agent.conversation_config?.agent?.prompt?.knowledge_base ?? []
    await this.req('PATCH', `/v1/convai/agents/${providerAgentId}`, {
      conversation_config: {
        agent: {
          prompt: {
            knowledge_base: [
              ...existing,
              { type: source.url ? 'url' : 'file', id: doc.id, name: source.url ?? source.file!.name },
            ],
          },
        },
      },
    })
    return { knowledgeId: doc.id as string }
  }

  async listKnowledge(providerAgentId: string): Promise<KnowledgeSource[]> {
    const agent = await this.req('GET', `/v1/convai/agents/${providerAgentId}`)
    const entries: any[] = agent.conversation_config?.agent?.prompt?.knowledge_base ?? []
    return entries.map((e) => ({ knowledgeId: e.id, name: e.name, type: e.type }))
  }

  // ponytail: force=true deletes the doc even if other agents reference it and
  // auto-detaches it everywhere — fine while docs are uploaded per-agent; switch
  // to detach-then-delete if docs ever get shared across agents.
  async removeKnowledge(_providerAgentId: string, knowledgeId: string) {
    await this.req('DELETE', `/v1/convai/knowledge-base/${knowledgeId}?force=true`)
  }

  // ponytail: first page of 100 voices only; add next_page_token pagination when
  // an account actually exceeds that.
  async listVoices(): Promise<Voice[]> {
    const res = await this.req('GET', '/v2/voices?page_size=100')
    return (res.voices as any[]).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      previewUrl: v.preview_url ?? null,
      category: v.category,
    }))
  }

  /** GET /v1/user — free, no credits consumed; the health check's reachability probe. */
  async ping(): Promise<void> {
    await this.req('GET', '/v1/user')
  }

  /**
   * Standalone tools + prompt.tool_ids (inline prompt.tools was removed by
   * ElevenLabs 2025-07-23; verified against docs 2026-07-12). Replace-then-
   * delete: create the new tools, point tool_ids at exactly them, then delete
   * the previously attached ones — idempotent, no orphan tools accumulate.
   * ponytail: secretHeader is stored as a plain header string, visible to our
   * own workspace members via the tools API — switch to POST /v1/convai/secrets
   * + {secret_id} if the workspace ever has untrusted members.
   */
  async setAgentTools(providerAgentId: string, tools: AgentTool[]) {
    const SYSTEM_VARS = {
      conversationId: 'system__conversation_id',
      callerId: 'system__caller_id',
      agentId: 'system__agent_id',
    } as const

    const agent = await this.req('GET', `/v1/convai/agents/${providerAgentId}`)
    const oldIds: string[] = agent.conversation_config?.agent?.prompt?.tool_ids ?? []

    const newIds: string[] = []
    for (const t of tools) {
      const res = await this.req('POST', '/v1/convai/tools', {
        tool_config: {
          type: 'webhook',
          name: t.name,
          description: t.description,
          response_timeout_secs: t.timeoutSecs ?? 20,
          api_schema: {
            url: t.url,
            method: 'POST',
            content_type: 'application/json',
            ...(t.secretHeader && { request_headers: { [t.secretHeader.name]: t.secretHeader.value } }),
            request_body_schema: {
              type: 'object',
              required: t.params.filter((p) => p.required).map((p) => p.name),
              properties: {
                ...Object.fromEntries(
                  t.params.map((p) => [p.name, { type: p.type, description: p.description }])
                ),
                ...Object.fromEntries(
                  (t.systemParams ?? []).map((p) => [
                    p.name,
                    { type: 'string', dynamic_variable: SYSTEM_VARS[p.source] },
                  ])
                ),
              },
            },
          },
        },
      })
      newIds.push(res.id as string)
    }

    await this.req('PATCH', `/v1/convai/agents/${providerAgentId}`, {
      conversation_config: { agent: { prompt: { tool_ids: newIds } } },
    })

    for (const id of oldIds) {
      await this.req('DELETE', `/v1/convai/tools/${id}`).catch(() => {
        /* already gone or shared — an orphan tool is harmless */
      })
    }
  }

  /** Embed per https://elevenlabs.io/docs/eleven-agents/customization/widget —
   *  NOTE: the widget needs the agent public with authentication disabled.
   *  dynamic-variables: a JSON-object string, e.g. '{"user_name":"John"}'
   *  (verified 2026-07-13 against the widget + dynamic-variables docs). */
  testWidgetEmbed(providerAgentId: string) {
    return {
      scriptSrc: 'https://unpkg.com/@elevenlabs/convai-widget-embed',
      tagName: 'elevenlabs-convai',
      attrs: { 'agent-id': providerAgentId },
      dynamicVariablesAttr: 'dynamic-variables',
    }
  }

  /** platform_settings.auth.enable_auth=false ⇒ public (widget works signed-out).
   *  Verified 2026-07-13; the field sits behind a $ref in the create schema —
   *  confirm on a live GET. https://elevenlabs.io/docs/eleven-agents/customization/authentication */
  async setAgentPublic(providerAgentId: string, isPublic: boolean) {
    await this.req('PATCH', `/v1/convai/agents/${providerAgentId}`, {
      platform_settings: { auth: { enable_auth: !isPublic } },
    })
  }

  /** POST /v1/convai/secrets {type:'new',name,value} → {secret_id} (verified
   *  2026-07-13). Referenced elsewhere as {secret_id}, so a custom-LLM key lands
   *  at the provider, never in our DB. https://elevenlabs.io/docs/api-reference/workspace/secrets/create */
  async createSecret(name: string, value: string) {
    const res = await this.req('POST', '/v1/convai/secrets', { type: 'new', name, value })
    return { secretId: res.secret_id as string }
  }

  /** GET /v1/convai/conversations/{id}/audio — verified against docs 2026-07-12. */
  // ponytail: buffered, not streamed — call recordings are a few MB and a
  // Content-Length makes <audio> seeking reliable; stream + Range support if
  // recordings ever get long.
  async fetchRecording(providerCallId: string) {
    const res = await fetch(`${BASE}/v1/convai/conversations/${providerCallId}/audio`, {
      headers: { 'xi-api-key': this.opts.apiKey },
    })
    if (!res.ok) {
      throw new Error(`ElevenLabs GET conversation audio → ${res.status}: ${await res.text()}`)
    }
    return {
      audio: await res.arrayBuffer(),
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
    }
  }

  /** GET /v1/convai/conversations with call_start_{after,before}_unix + cursor
   *  pagination (page_size max 100, has_more/next_cursor) — verified against docs 2026-07-12. */
  async listCalls(afterUnix: number, beforeUnix: number): Promise<ProviderCall[]> {
    const out: ProviderCall[] = []
    let cursor: string | undefined
    do {
      const qs = new URLSearchParams({
        call_start_after_unix: String(afterUnix),
        call_start_before_unix: String(beforeUnix),
        page_size: '100',
        ...(cursor && { cursor }),
      })
      const res = await this.req('GET', `/v1/convai/conversations?${qs}`)
      for (const c of res.conversations as any[]) {
        out.push({
          providerCallId: c.conversation_id,
          providerAgentId: c.agent_id,
          direction: c.direction === 'outbound' ? 'outbound' : 'inbound',
          startedAt: new Date(c.start_time_unix_secs * 1000).toISOString(),
          durationSecs: c.call_duration_secs ?? 0,
          status: c.status ?? 'done',
        })
      }
      cursor = res.has_more ? res.next_cursor : undefined
    } while (cursor)
    return out
  }

  /**
   * Header format: `elevenlabs-signature: t=<unix>,v0=<hex hmac-sha256 of "<t>.<rawBody>">`.
   * VERIFY against a live webhook in Phase 1 (docs point at SDK constructEvent).
   */
  verifyWebhook(req: WebhookRequest): boolean {
    if (!req.signature) return false
    const parts = Object.fromEntries(req.signature.split(',').map((p) => p.split('=', 2)))
    const t = parts['t']
    const v0 = parts['v0']
    if (!t || !v0) return false
    if (Math.abs(Date.now() / 1000 - Number(t)) > 30 * 60) return false // stale/replayed
    const digest = createHmac('sha256', this.opts.webhookSecret)
      .update(`${t}.${req.rawBody}`)
      .digest('hex')
    const a = Buffer.from(v0)
    const b = Buffer.from(digest)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /** Normalizes a post_call_transcription webhook payload. */
  normalizeCallEvent(payload: unknown): CallEvent {
    const p = payload as any
    if (p?.type !== 'post_call_transcription' || !p?.data?.conversation_id) {
      throw new Error(`Not a post_call_transcription payload: ${p?.type}`)
    }
    const d = p.data
    const meta = d.metadata ?? {}
    const pc = meta.phone_call ?? {} // {direction, agent_number, external_number} — VERIFY vs captured fixture
    const direction: CallEvent['direction'] = pc.direction === 'outbound' ? 'outbound' : 'inbound'
    const analysis = this.normalizeAnalysis(d.analysis)
    return {
      providerCallId: d.conversation_id,
      direction,
      fromE164: (direction === 'inbound' ? pc.external_number : pc.agent_number) ?? null,
      toE164: (direction === 'inbound' ? pc.agent_number : pc.external_number) ?? null,
      startedAt: new Date((meta.start_time_unix_secs ?? p.event_timestamp) * 1000).toISOString(),
      durationSecs: meta.call_duration_secs ?? 0,
      transcript: d.transcript ?? [],
      // Recording arrives via a separate post_call_audio webhook / fetch API — Phase 3 concern.
      recordingUrl: null,
      status: d.status ?? 'done',
      // metadata.cost is in ElevenLabs credits, not cents; money comes from reconciliation (rule 5).
      ...(analysis && { analysis }),
    }
  }

  /**
   * Phase 12: map data.analysis (verified against the Get-Conversation OpenAPI,
   * same model as the post_call_transcription webhook):
   *   call_successful: 'success'|'failure'|'unknown'  → success true/false/undefined
   *   evaluation_criteria_results: map<id,{criteria_id,result,rationale}>  → criteria[]
   *   data_collection_results: map<id,{value,rationale,...}>  → data{id: value}
   * Sentiment is NOT native to ElevenLabs; a seeded "user_sentiment" data field,
   * if present, is surfaced into the neutral `sentiment` slot for convenience.
   */
  private normalizeAnalysis(a: any): CallAnalysis | undefined {
    if (!a || typeof a !== 'object') return undefined
    const out: CallAnalysis = {}
    if (a.call_successful === 'success') out.success = true
    else if (a.call_successful === 'failure') out.success = false

    if (a.evaluation_criteria_results && typeof a.evaluation_criteria_results === 'object') {
      const criteria = Object.values(a.evaluation_criteria_results as Record<string, any>).map((r) => ({
        name: r.criteria_id ?? '',
        result: r.result ?? 'unknown',
        ...(r.rationale && { rationale: r.rationale }),
      }))
      if (criteria.length) out.criteria = criteria
    }

    if (a.data_collection_results && typeof a.data_collection_results === 'object') {
      const data = Object.fromEntries(
        Object.entries(a.data_collection_results as Record<string, any>).map(([k, v]) => [k, v?.value])
      )
      if (Object.keys(data).length) {
        out.data = data
        if (data.user_sentiment != null) out.sentiment = String(data.user_sentiment)
      }
    }

    return Object.keys(out).length ? out : undefined
  }
}
