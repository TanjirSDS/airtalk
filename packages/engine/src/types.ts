// The provider-agnostic contract. Nothing outside packages/engine may import
// provider SDKs or know provider payload shapes — only these types.

export interface AgentConfig {
  name: string
  systemPrompt: string
  firstMessage: string
  voiceId: string
  /** Provider LLM identifier, e.g. 'gpt-4o' or 'gemini-2.5-flash'. Provider default if omitted. */
  llm?: string
  /** ISO 639-1, defaults to 'en'. */
  language?: string
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
   */
  testWidgetEmbed(providerAgentId: string): {
    scriptSrc: string
    tagName: string
    attrs: Record<string, string>
  }
  verifyWebhook(req: WebhookRequest): boolean
  normalizeCallEvent(payload: unknown): CallEvent
}
