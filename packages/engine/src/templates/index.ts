// Template registry. Browser-safe (see shared.ts) — the web app's wizard imports
// this via '@airtalk/engine/templates' without pulling in the provider adapter.

import type { AgentConfig } from '../types'
import { booking } from './booking'
import { leadQualifier } from './lead-qualifier'
import { receptionist } from './receptionist'
import type { BusinessProfile } from './shared'

export type { BusinessProfile, GreetingStyle } from './shared'

export const templates = {
  receptionist,
  booking,
  lead_qualifier: leadQualifier,
} satisfies Record<string, (p: BusinessProfile) => AgentConfig>

export type TemplateKey = keyof typeof templates

/** Display metadata for pickers. */
export const TEMPLATE_INFO: { key: TemplateKey; name: string; description: string }[] = [
  {
    key: 'receptionist',
    name: 'Receptionist',
    description: 'Answers calls, handles FAQs, takes messages for callbacks.',
  },
  {
    key: 'booking',
    name: 'Booking assistant',
    description: 'Captures appointment requests with preferred times for you to confirm.',
  },
  {
    key: 'lead_qualifier',
    name: 'Lead qualifier',
    description: 'Screens new enquiries: what they need, when, and how to reach them.',
  },
]

export function buildAgentConfig(template: TemplateKey, profile: BusinessProfile): AgentConfig {
  return templates[template](profile)
}
