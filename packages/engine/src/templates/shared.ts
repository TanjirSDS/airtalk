// Shared building blocks for agent templates. PURE code only — this directory is
// exposed to the browser via the '@airtalk/engine/templates' subpath, so nothing
// here (or in the template files) may import node APIs or the provider adapter.

export interface BusinessProfile {
  businessName: string
  industry: string
  /** Free text, e.g. "Mon–Fri 8am–6pm, Sat 9–1". */
  hours: string
  services: string[]
  faqs: { q: string; a: string }[]
  /** Human phone number for escalation/transfer mentions. */
  escalationNumber?: string
  greetingStyle: 'professional' | 'friendly' | 'casual'
  voiceId: string
  /** Phase 7: org has a calendar connected — the booking agent books real slots
   *  via its check_availability_and_book tool instead of taking a message. */
  liveBooking?: boolean
  /** Phase 8: applied prompt_tweak/escalation_rule suggestions land here and
   *  render as a "Learned adjustments" section in every template's prompt. */
  extraInstructions?: string[]
}

export type GreetingStyle = BusinessProfile['greetingStyle']

// ---------------------------------------------------------------------------
// TONE — one paragraph injected into every prompt. Tune the voice here once
// rather than per template.
// ---------------------------------------------------------------------------
export const TONE: Record<GreetingStyle, string> = {
  professional:
    'Tone: polished, courteous and efficient. Use complete sentences, no slang. Address the caller respectfully.',
  friendly:
    'Tone: warm, upbeat and personable. Sound like a helpful long-time employee. Contractions are fine.',
  casual:
    'Tone: relaxed and conversational, like a neighborly small-business owner. Keep it light but still helpful.',
}

// ---------------------------------------------------------------------------
// GREETING (the agent's first_message). Must disclose the AI up front — this is
// a hard product requirement, keep the disclosure in every variant.
// ---------------------------------------------------------------------------
export function greeting(p: BusinessProfile): string {
  switch (p.greetingStyle) {
    case 'professional':
      return `Thank you for calling ${p.businessName}. I'm an AI assistant and I can help with most questions. How may I help you today?`
    case 'friendly':
      return `Hi, thanks for calling ${p.businessName}! I'm the AI assistant here — how can I help you today?`
    case 'casual':
      return `Hey there, you've reached ${p.businessName}! I'm the AI assistant — what can I do for you?`
  }
}

// ---------------------------------------------------------------------------
// FACTS — everything the agent is allowed to state about the business.
// Rendered as a block so it's easy to spot (and tune) in the final prompt.
// ---------------------------------------------------------------------------
export function businessFacts(p: BusinessProfile): string {
  const faqs = p.faqs.length
    ? p.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')
    : '(none provided)'
  return `## Business facts (the ONLY facts you may state — never invent others)
Business: ${p.businessName} (${p.industry})
Hours: ${p.hours}
Services: ${p.services.join(', ') || '(none listed)'}

## Frequently asked questions
${faqs}`
}

// ---------------------------------------------------------------------------
// CONDUCT — non-negotiable call rules shared by every template:
// AI disclosure, stay on-topic, capture caller details, graceful failure.
// ---------------------------------------------------------------------------
export function conductRules(p: BusinessProfile): string {
  const escalation = p.escalationNumber
    ? `offer to have a human call them back, or give them the direct line ${p.escalationNumber}`
    : 'offer to take a detailed message so a human can call them back'
  return `## Rules for every call
1. You already disclosed you are an AI assistant in your greeting; if asked, confirm it plainly. Never pretend to be human.
2. Stay strictly on-topic: ${p.businessName} and its services. Politely decline anything else (news, other businesses, general chit-chat) and steer back.
3. Before the call ends, always capture: the caller's NAME, PHONE NUMBER, and the REASON for their call. Read the phone number back to confirm it.
4. If you cannot help, the caller is frustrated, or they ask for a human: ${escalation}.
5. Only state facts from the business facts section above. If you don't know, say so and take a message.
6. Keep answers short — this is a phone call, not an essay.
7. If the person asks not to be called again, to be removed from a list, or to stop receiving calls: comply IMMEDIATELY. Apologize once, confirm plainly that they will not be contacted again, and end the call politely. Never argue, negotiate, or try to keep them on the line.${learnedAdjustments(p)}`
}

// ---------------------------------------------------------------------------
// Phase 10: "Generate from prompt" hands us an LLM-drafted prompt. Whatever the
// model returns, we ALWAYS append our mandatory conduct rules and guarantee the
// greeting discloses the AI before saving. Pure — the server action calls this.
// ---------------------------------------------------------------------------
export function ensureDisclosureAndConduct(
  cfg: { name: string; systemPrompt: string; firstMessage: string; voiceId: string },
  businessName: string
): { name: string; systemPrompt: string; firstMessage: string; voiceId: string } {
  // conductRules only needs a name; the rest of the profile is irrelevant here.
  const p = {
    businessName,
    industry: '',
    hours: '',
    services: [],
    faqs: [],
    greetingStyle: 'friendly' as const,
    voiceId: cfg.voiceId,
  }
  const firstMessage = /\bAI\b/i.test(cfg.firstMessage) ? cfg.firstMessage : greeting(p)
  const systemPrompt = `${cfg.systemPrompt.trim()}\n\n${conductRules(p)}`
  return { ...cfg, firstMessage, systemPrompt }
}

/** Phase 8: reviewed-and-applied suggestions, appended after the conduct rules. */
function learnedAdjustments(p: BusinessProfile): string {
  if (!p.extraInstructions?.length) return ''
  return `\n\n## Learned adjustments (from reviewed past calls)\n${p.extraInstructions
    .map((x, i) => `${i + 1}. ${x}`)
    .join('\n')}`
}
