// Phase 11: LLM picker options. Browser-safe (templates subpath) — the builder
// renders these with a static cost/quality hint per model.
//
// Sources (verified 2026-07-13):
//   model list + path prompt.llm, default gemini-2.5-flash:
//     https://elevenlabs.io/docs/api-reference/agents/create
//   real-time-voice guidance (prefer Flash/Haiku/4o-mini; Sonnet/GPT-4 for hard tasks):
//     https://elevenlabs.io/docs/eleven-agents/customization/llm
//
// ponytail: a curated subset of the long-standing, safe-to-hardcode ids only. The
// newer schema ids (qwen*, gpt-oss-*, glm-*, top gpt-5.x) came through a doc
// summarizer and some looked irregular — add them here once confirmed on a live
// GET /v1/convai/agents. 'custom-llm' is set via AgentConfig.customLlm, not here.

export const DEFAULT_LLM = 'gemini-2.5-flash'

export interface ModelInfo {
  id: string
  label: string
  /** One-line cost/quality/latency guidance shown next to the option. */
  hint: string
}

export const MODEL_INFO: ModelInfo[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Default. Fast and low cost — best all-round for voice.' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', hint: 'Fastest and cheapest; good for simple call flows.' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', hint: 'Fast and inexpensive; solid for FAQs and message-taking.' },
  { id: 'gpt-4o', label: 'GPT-4o', hint: 'Balanced quality and speed; higher cost per minute.' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'Fast, low cost, strong at following instructions.' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', hint: 'Highest quality for complex calls; higher cost and latency.' },
]

export function modelLabel(id: string | undefined): string {
  if (!id) return MODEL_INFO.find((m) => m.id === DEFAULT_LLM)!.label
  return MODEL_INFO.find((m) => m.id === id)?.label ?? id
}
