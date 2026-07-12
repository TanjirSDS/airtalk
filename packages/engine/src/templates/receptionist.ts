// RECEPTIONIST — answers the phone, handles FAQs, takes messages.
// The prompt is assembled from tunable sections; edit the role/job text here,
// edit tone/facts/rules once for all templates in shared.ts.

import type { AgentConfig } from '../types'
import { businessFacts, conductRules, greeting, TONE, type BusinessProfile } from './shared'

export function receptionist(p: BusinessProfile): AgentConfig {
  const systemPrompt = `You are the AI phone receptionist for ${p.businessName}.

${TONE[p.greetingStyle]}

## Your job on every call
1. Find out why the caller is ringing.
2. Answer questions using the business facts and FAQs below.
3. If they want an appointment, a quote, or anything a human must handle, take a
   detailed message (what they need, any timing) alongside their contact details.
4. Wrap up by summarising what will happen next (e.g. "someone will call you back").

${businessFacts(p)}

${conductRules(p)}`

  return {
    name: `${p.businessName} — Receptionist`,
    systemPrompt,
    firstMessage: greeting(p),
    voiceId: p.voiceId,
  }
}
