// Template registry. Browser-safe (see shared.ts) — the web app's create surface
// imports this via '@airtalk/engine/templates' without pulling in the provider adapter.

import type { AgentConfig } from '../types'
import { booking } from './booking'
import { afterHours, orderStatus, outboundSales, support, winBack } from './catalog'
import { leadQualifier } from './lead-qualifier'
import { receptionist } from './receptionist'
import type { BusinessProfile } from './shared'

export type { BusinessProfile, GreetingStyle } from './shared'
export { ensureDisclosureAndConduct } from './shared'
export {
  normalizeStoredConfig,
  normalizeStoredConfigSafe,
  scratchAgentConfig,
  type AgentType,
  type SeedInput,
  type StoredAgentConfig,
} from './stored'
export {
  applySuggestionToPrompt,
  FAQ_HEADING,
  LEARNED_HEADING,
  SUGGESTION_TYPES,
  suggestionTitle,
  type SuggestionPayload,
  type SuggestionType,
} from './merge'
export { getSection, hasSection, removeSection, setSection } from './managed'
export {
  defaultWorkflow,
  E164,
  END_NODE_ID,
  validateWorkflow,
  WELCOME_NODE_ID,
  wrapPromptAsFlow,
} from './workflow'
export type {
  WorkflowEdge,
  WorkflowEntryBehavior,
  WorkflowGraph,
  WorkflowKb,
  WorkflowNode,
  WorkflowNodeType,
} from '../types'
export { DEFAULT_LLM, MODEL_INFO, modelLabel, type ModelInfo } from './model-info'
export { CALL_DEFAULTS, DEFAULT_ANALYSIS, SPEECH_DEFAULTS } from './settings-defaults'
export {
  HANDBOOK_HEADING,
  HANDBOOK_PRESETS,
  HANDBOOK_TABS,
  isPresetOn,
  togglePreset,
  type HandbookPreset,
  type HandbookTab,
} from './handbook'

export const templates = {
  receptionist,
  after_hours: afterHours,
  booking,
  lead_qualifier: leadQualifier,
  outbound_sales: outboundSales,
  win_back: winBack,
  support,
  order_status: orderStatus,
} satisfies Record<string, (p: BusinessProfile) => AgentConfig>

export type TemplateKey = keyof typeof templates

export const TEMPLATE_CATEGORIES = [
  'Receptionist',
  'Appointment Booking',
  'Lead Qualification',
  'Outbound Sales',
  'Customer Support',
] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** Display metadata for the create-surface template grid. */
export const TEMPLATE_INFO: {
  key: TemplateKey
  name: string
  description: string
  category: TemplateCategory
}[] = [
  {
    key: 'receptionist',
    name: 'Receptionist',
    description: 'Answers calls, handles FAQs, takes messages for callbacks.',
    category: 'Receptionist',
  },
  {
    key: 'after_hours',
    name: 'After-hours answering',
    description: 'Covers calls when you are closed and takes messages for the morning.',
    category: 'Receptionist',
  },
  {
    key: 'booking',
    name: 'Appointment booking',
    description: 'Captures appointment requests with preferred times (or books real slots).',
    category: 'Appointment Booking',
  },
  {
    key: 'lead_qualifier',
    name: 'Lead qualifier',
    description: 'Screens new enquiries: what they need, when, and how to reach them.',
    category: 'Lead Qualification',
  },
  {
    key: 'outbound_sales',
    name: 'Outbound sales',
    description: 'Calls prospects, gauges interest, and books follow-ups.',
    category: 'Outbound Sales',
  },
  {
    key: 'win_back',
    name: 'Customer win-back',
    description: 'Reconnects with past customers and surfaces new opportunities.',
    category: 'Outbound Sales',
  },
  {
    key: 'support',
    name: 'Customer support',
    description: 'Resolves common issues and routes the rest to a human.',
    category: 'Customer Support',
  },
  {
    key: 'order_status',
    name: 'Order & status line',
    description: 'Answers order/appointment status questions and takes lookups as messages.',
    category: 'Customer Support',
  },
]

export function buildAgentConfig(template: TemplateKey, profile: BusinessProfile): AgentConfig {
  return templates[template](profile)
}
