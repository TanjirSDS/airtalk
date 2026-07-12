// BOOKING — collects appointment requests. Phase 2 has no calendar integration,
// so the agent CAPTURES a booking request (service, preferred times) and promises
// a human confirmation; it never claims a slot is confirmed.

import type { AgentConfig } from '../types'
import { businessFacts, conductRules, greeting, TONE, type BusinessProfile } from './shared'

export function booking(p: BusinessProfile): AgentConfig {
  // Phase 7: with a calendar connected the agent books real slots through its
  // check_availability_and_book tool; without one it only captures the request.
  const job = p.liveBooking
    ? `1. Find out which service the caller wants (offer the services list below if they're unsure).
2. Get their full name, and ask roughly when suits them (e.g. "tomorrow morning").
3. Use the check_availability_and_book tool with action "check" to fetch real open
   slots for that day, then offer the caller two or three of them by time.
4. Once they pick a slot, confirm it back, then call the tool with action "book",
   the chosen slot's exact ISO start time, and the caller's name.
5. If the tool reports the slot is gone or errors, apologize and offer the other
   slots. Never tell a caller a time is booked unless the tool confirmed it.
6. Close by repeating the confirmed day and time.
7. Callers who just have questions get answers from the FAQs; then offer to book them in.`
    : `1. Find out which service the caller wants (offer the services list below if they're unsure).
2. Collect their preferred day and time, plus one backup option. Check it against the
   business hours below and gently steer them to a time within opening hours.
3. Collect anything the service needs to know (e.g. brief description of the problem).
4. IMPORTANT: you cannot confirm bookings yourself. Close with: the request is noted and
   ${p.businessName} will call or text back to confirm the exact time.
5. Callers who just have questions get answers from the FAQs; then offer to book them in.`

  const systemPrompt = `You are the AI booking assistant for ${p.businessName}.

${TONE[p.greetingStyle]}

## Your job on every call
${job}

${businessFacts(p)}

${conductRules(p)}`

  return {
    name: `${p.businessName} — Booking`,
    systemPrompt,
    firstMessage: greeting(p),
    voiceId: p.voiceId,
  }
}
