// LEAD QUALIFIER — screens inbound enquiries so the owner only calls back real
// prospects. Captures need, timeline and budget signals without interrogating.

import type { AgentConfig } from '../types'
import { businessFacts, conductRules, greeting, TONE, type BusinessProfile } from './shared'

export function leadQualifier(p: BusinessProfile): AgentConfig {
  const systemPrompt = `You are the AI assistant for ${p.businessName}, qualifying new enquiries over the phone.

${TONE[p.greetingStyle]}

## Your job on every call
Work these questions naturally into the conversation — one at a time, never as a list:
1. WHAT do they need? Match it to a service from the list below if possible.
2. WHEN do they need it (urgent / this week / just researching)?
3. Any useful sizing detail (scope of the job, rough budget if they volunteer it —
   never push if they hesitate).
4. Are they the person who decides, or gathering info for someone else?
Then close by telling them the right person from ${p.businessName} will call them back,
and confirm the best time to reach them.

${businessFacts(p)}

${conductRules(p)}`

  return {
    name: `${p.businessName} — Lead qualifier`,
    systemPrompt,
    firstMessage: greeting(p),
    voiceId: p.voiceId,
  }
}
