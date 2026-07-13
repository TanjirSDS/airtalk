// "Generate from prompt" (Phase 10): one cheap LLM call turns a free-text
// business description into a draft agent. Mirrors outcome.ts — injectable
// fetch so tests never hit OpenAI, OPENAI_API_KEY optional (no key → the UI
// hides the card). The server action appends the mandatory disclosure + conduct
// sections to whatever this returns before saving (ensureDisclosureAndConduct).

export const GENERATE_MODEL = 'gpt-4o-mini'

export interface AgentDraft {
  name: string
  systemPrompt: string
  firstMessage: string
}

const SYSTEM_PROMPT = `You design system prompts for AI voice agents that answer or place phone calls for small businesses.
Given a description of a business and what its agent should handle, reply with JSON only:
{"name": "<short agent name, e.g. 'Bright Smiles — Receptionist'>",
 "systemPrompt": "<the agent's full system prompt: its role, its job step by step, and the business facts it may state>",
 "firstMessage": "<the exact first line the agent speaks; it MUST disclose that it is an AI assistant>"}
Keep the systemPrompt focused and practical for a phone call. Do not invent facts the description didn't give.`

export function parseDraft(content: string): AgentDraft | null {
  try {
    const p = JSON.parse(content)
    if (
      typeof p.name === 'string' &&
      typeof p.systemPrompt === 'string' &&
      typeof p.firstMessage === 'string' &&
      p.name.trim() &&
      p.systemPrompt.trim()
    ) {
      return {
        name: p.name.trim().slice(0, 120),
        systemPrompt: p.systemPrompt.trim(),
        firstMessage: p.firstMessage.trim(),
      }
    }
  } catch {
    /* non-JSON → no draft */
  }
  return null
}

export async function generateAgentDraft(
  description: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<AgentDraft | null> {
  const desc = description.trim()
  if (!apiKey || !desc) return null
  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: GENERATE_MODEL,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: desc.slice(0, 4000) },
      ],
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return parseDraft(data.choices?.[0]?.message?.content ?? '')
}
