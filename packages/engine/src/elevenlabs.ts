import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AgentConfig, CallEvent, VoiceEngine, WebhookRequest } from './types'

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

  /** Maps our AgentConfig onto ElevenLabs' nested conversation_config. */
  private toProviderConfig(cfg: Partial<AgentConfig>) {
    return {
      ...(cfg.name !== undefined && { name: cfg.name }),
      conversation_config: {
        agent: {
          ...(cfg.firstMessage !== undefined && { first_message: cfg.firstMessage }),
          language: cfg.language ?? 'en',
          prompt: {
            ...(cfg.systemPrompt !== undefined && { prompt: cfg.systemPrompt }),
            ...(cfg.llm !== undefined && { llm: cfg.llm }),
          },
        },
        ...(cfg.voiceId !== undefined && { tts: { voice_id: cfg.voiceId } }),
      },
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

    // Attach the document to the agent's prompt.knowledge_base list. VERIFY shape in Phase 2.
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
    }
  }
}
