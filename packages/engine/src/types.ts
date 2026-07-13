// The provider-agnostic contract. Nothing outside packages/engine may import
// provider SDKs or know provider payload shapes — only these types.

export interface AgentConfig {
  name: string
  systemPrompt: string
  /** The line the agent speaks first. Empty string = user speaks first (agent waits). */
  firstMessage: string
  voiceId: string
  /** Provider LLM identifier, e.g. 'gpt-4o' or 'gemini-2.5-flash'. Provider default if omitted. */
  llm?: string
  /** ISO 639-1, defaults to 'en'. */
  language?: string
  /**
   * Bring-your-own OpenAI-compatible endpoint (agent_type 'custom_llm'). The API
   * key is NEVER stored here — only the id of a provider-side workspace secret.
   */
  customLlm?: { url: string; modelId?: string; apiKeySecretId?: string }
}

export interface CallEvent {
  providerCallId: string
  direction: 'inbound' | 'outbound'
  fromE164: string | null
  toE164: string | null
  startedAt: string // ISO 8601
  durationSecs: number
  transcript: unknown // provider-normalized turn list, stored as jsonb
  recordingUrl: string | null
  status: string
  /** Optional: rule 5 says billing truth comes from reconciliation, not webhooks. */
  costCents?: number
}

export interface Voice {
  voiceId: string
  name: string
  previewUrl: string | null
  category?: string
}

export interface KnowledgeSource {
  knowledgeId: string
  name: string
  type: 'url' | 'file'
}

/** One call as the provider reports it — reconciliation's source of truth (rule 5). */
export interface ProviderCall {
  providerCallId: string
  providerAgentId: string
  direction: 'inbound' | 'outbound'
  startedAt: string // ISO 8601
  durationSecs: number
  status: string
}

/**
 * A server tool the agent can call mid-conversation (Phase 7): the provider
 * POSTs JSON to `url`, the response body is spoken back by the LLM.
 */
export interface AgentTool {
  name: string
  description: string
  url: string
  /** Static header sent with every invocation so `url` can authenticate the provider. */
  secretHeader?: { name: string; value: string }
  /** Body fields the LLM fills in. */
  params: { name: string; type: 'string' | 'number' | 'boolean'; description: string; required?: boolean }[]
  /** Body fields the PROVIDER fills in at call time (which call is invoking us). */
  systemParams?: { name: string; source: 'conversationId' | 'callerId' | 'agentId' }[]
  timeoutSecs?: number
}

/** Framework-agnostic view of an incoming webhook request. */
export interface WebhookRequest {
  rawBody: string
  /** Value of the provider signature header (e.g. 'elevenlabs-signature'), if present. */
  signature: string | null
}

export interface VoiceEngine {
  createAgent(cfg: AgentConfig): Promise<{ providerAgentId: string }>
  updateAgent(providerAgentId: string, cfg: Partial<AgentConfig>): Promise<void>
  deleteAgent(providerAgentId: string): Promise<void>
  importNumber(twilioSid: string, e164: string): Promise<{ providerNumberId: string }>
  attachNumber(providerNumberId: string, providerAgentId: string): Promise<void>
  /** Unassign the agent so the number stops answering (cap enforcement). */
  detachNumber(providerNumberId: string): Promise<void>
  startOutboundCall(
    providerAgentId: string,
    toE164: string,
    vars?: Record<string, string>
  ): Promise<{ providerCallId: string }>
  startBatch(
    providerAgentId: string,
    contacts: { e164: string; vars?: Record<string, string> }[]
  ): Promise<{ batchId: string }>
  addKnowledge(
    providerAgentId: string,
    source: { url?: string; file?: { name: string; data: Blob } }
  ): Promise<{ knowledgeId: string }>
  listKnowledge(providerAgentId: string): Promise<KnowledgeSource[]>
  removeKnowledge(providerAgentId: string, knowledgeId: string): Promise<void>
  listVoices(): Promise<Voice[]>
  /**
   * Descriptor for the provider's in-browser test-call widget: the UI injects
   * `scriptSrc` and renders `<tagName {...attrs}>`, never knowing the provider.
   * `dynamicVariablesAttr` names the attribute that carries a JSON-string of
   * dynamic variables, so the (provider-blind) component can inject test inputs.
   */
  testWidgetEmbed(providerAgentId: string): {
    scriptSrc: string
    tagName: string
    attrs: Record<string, string>
    dynamicVariablesAttr: string
  }
  /**
   * Make the agent public (widget works signed-out) or private. Toggling on a
   * public share turns this off-auth on; toggling the share off restores it.
   */
  setAgentPublic(providerAgentId: string, isPublic: boolean): Promise<void>
  /**
   * Store a value as a provider-side workspace secret and return its id. Used so
   * a custom-LLM API key lands at the provider, never in our database.
   */
  createSecret(name: string, value: string): Promise<{ secretId: string }>

  /** All provider calls started in [afterUnix, beforeUnix) — nightly reconciliation. */
  listCalls(afterUnix: number, beforeUnix: number): Promise<ProviderCall[]>
  /** Replace the agent's server tools with exactly this set (empty array = none). */
  setAgentTools(providerAgentId: string, tools: AgentTool[]): Promise<void>
  /** Cheapest authenticated call — health checks. Rejects when the provider or key is bad. */
  ping(): Promise<void>
  verifyWebhook(req: WebhookRequest): boolean
  normalizeCallEvent(payload: unknown): CallEvent
  /**
   * Raw recording audio for a finished call, served to the UI through an app
   * route (providers like ElevenLabs expose audio via API, not a public URL).
   */
  fetchRecording(providerCallId: string): Promise<{ audio: ArrayBuffer; contentType: string }>
}
