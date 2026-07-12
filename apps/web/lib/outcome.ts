// The single model+prompt module for call outcome extraction (Phase 3 item 3).
// One cheap LLM call per finished call, best-effort: any failure → null, the
// call row just keeps outcome/summary null.

export const OUTCOMES = [
  'booked',
  'lead_captured',
  'question_answered',
  'escalated',
  'voicemail',
  'spam',
  'failed',
  'opt_out',
] as const
export type Outcome = (typeof OUTCOMES)[number]

export interface CallOutcome {
  outcome: Outcome
  summary: string
}

/** Fixed outcome → categorical color map for charts/badges (validated with the dataviz palette checker). */
export const OUTCOME_COLORS: Record<Outcome, string> = {
  booked: '#2a78d6',
  lead_captured: '#1baf7a',
  question_answered: '#eda100',
  escalated: '#4a3aa7',
  voicemail: '#e87ba4',
  spam: '#eb6834',
  failed: '#e34948',
  opt_out: '#77777c',
}

export const OUTCOME_MODEL = 'gpt-4o-mini'

const SYSTEM_PROMPT = `You classify transcripts of phone calls handled by an AI voice agent for a small business.
Reply with JSON only: {"outcome": "<one of: ${OUTCOMES.join(', ')}>", "summary": "<one line, max 20 words>"}.
Definitions:
- booked: an appointment/reservation/job was scheduled or confirmed.
- lead_captured: caller's contact details were collected for follow-up, but nothing was booked.
- question_answered: the caller's question was answered; no booking or follow-up needed.
- escalated: the call was handed off to a human or the caller was told a human will call back for something the agent could not handle.
- voicemail: the call reached a voicemail/answering machine.
- spam: robocall, telemarketer, or clearly unwanted caller.
- failed: the call failed or ended before any meaningful exchange.
- opt_out: the person asked not to be called again, to be removed from a list, or to stop receiving calls. This overrides every other outcome — if they asked to be removed at any point, the outcome is opt_out.`

interface Turn {
  role?: string
  message?: string | null
}

export function buildMessages(transcript: Turn[]) {
  const lines = transcript
    .filter((t) => t.message)
    .map((t) => `${t.role === 'agent' ? 'Agent' : 'Caller'}: ${t.message}`)
    .join('\n')
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines },
  ]
}

export function parseOutcome(content: string): CallOutcome | null {
  try {
    const parsed = JSON.parse(content)
    if ((OUTCOMES as readonly string[]).includes(parsed.outcome) && typeof parsed.summary === 'string') {
      return { outcome: parsed.outcome, summary: parsed.summary.slice(0, 300) }
    }
  } catch {
    /* model returned non-JSON — treat as no classification */
  }
  return null
}

/** fetchFn is injectable so the fixture test never talks to OpenAI. */
export async function classifyCall(
  transcript: unknown,
  apiKey: string | undefined,
  fetchFn: typeof fetch = fetch
): Promise<CallOutcome | null> {
  if (!apiKey || !Array.isArray(transcript)) return null
  const messages = buildMessages(transcript as Turn[])
  if (!messages[1].content) return null // nothing said → nothing to classify

  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OUTCOME_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return parseOutcome(data.choices?.[0]?.message?.content ?? '')
}
