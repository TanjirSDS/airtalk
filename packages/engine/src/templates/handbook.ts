// Phase 11: Agent Handbook — curated, toggleable prompt snippets grouped in three
// tabs. Each toggle inserts / removes one bullet in the managed "## Handbook"
// section of the freeform prompt (same mechanics as learning-merge, see merge.ts).
// Static, pure and browser-safe: the builder toggles these client-side.

import { getSection, setSection } from './managed'

export const HANDBOOK_HEADING = '## Handbook'

export const HANDBOOK_TABS = ['Personality & Tone', 'Accuracy & Format', 'Trust & Safety'] as const
export type HandbookTab = (typeof HANDBOOK_TABS)[number]

export interface HandbookPreset {
  id: string
  tab: HandbookTab
  label: string
  description: string
  /** Exact text of the bullet inserted into ## Handbook when the preset is on. */
  snippet: string
}

export const HANDBOOK_PRESETS: HandbookPreset[] = [
  // Personality & Tone
  {
    id: 'empathetic',
    tab: 'Personality & Tone',
    label: 'Lead with empathy',
    description: 'Acknowledge the caller before answering.',
    snippet: "Acknowledge the caller's situation with a brief, genuine phrase before answering.",
  },
  {
    id: 'upbeat',
    tab: 'Personality & Tone',
    label: 'Stay upbeat',
    description: 'Keep an energetic, positive tone.',
    snippet: 'Keep an upbeat, positive tone throughout the call, even when you cannot help.',
  },
  {
    id: 'no-filler',
    tab: 'Personality & Tone',
    label: 'No filler',
    description: 'Skip robotic filler and get to the point.',
    snippet: 'Avoid robotic filler ("As an AI...", "I understand your concern..."); get to the point.',
  },
  // Accuracy & Format
  {
    id: 'confirm-details',
    tab: 'Accuracy & Format',
    label: 'Confirm key details',
    description: 'Read names, numbers and times back.',
    snippet: 'Repeat names, phone numbers and appointment times back to the caller to confirm them.',
  },
  {
    id: 'no-speculation',
    tab: 'Accuracy & Format',
    label: 'Never guess',
    description: 'Take a message instead of speculating.',
    snippet: 'If you are not certain of an answer, say so and offer to take a message — never guess.',
  },
  {
    id: 'spell-out',
    tab: 'Accuracy & Format',
    label: 'Spell it out',
    description: 'Read numbers/emails digit-by-digit.',
    snippet: 'Read phone numbers digit by digit and email addresses character by character.',
  },
  // Trust & Safety
  {
    id: 'no-advice',
    tab: 'Trust & Safety',
    label: 'No professional advice',
    description: 'Decline medical/legal/financial advice.',
    snippet: 'Do not give medical, legal or financial advice; offer to connect the caller with a human instead.',
  },
  {
    id: 'protect-pii',
    tab: 'Trust & Safety',
    label: 'Protect sensitive data',
    description: 'Never read back cards or secrets.',
    snippet: 'Never read back full payment card numbers, passwords or other sensitive personal data.',
  },
  {
    id: 'emergency',
    tab: 'Trust & Safety',
    label: 'Handle emergencies',
    description: 'Route distress to humans/911.',
    snippet:
      'If the caller describes an emergency or is in distress, advise them to call emergency services and offer to connect a human immediately.',
  },
]

function bulletLines(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

/** Is this preset's snippet currently present in the ## Handbook section? */
export function isPresetOn(prompt: string, preset: HandbookPreset): boolean {
  const body = getSection(prompt, HANDBOOK_HEADING)
  return !!body && bulletLines(body).includes(preset.snippet)
}

/** Add or remove one preset's snippet from ## Handbook (empties → section removed). */
export function togglePreset(prompt: string, preset: HandbookPreset, on: boolean): string {
  let items = bulletLines(getSection(prompt, HANDBOOK_HEADING) ?? '')
  if (on) {
    if (!items.includes(preset.snippet)) items.push(preset.snippet)
  } else {
    items = items.filter((b) => b !== preset.snippet)
  }
  return setSection(prompt, HANDBOOK_HEADING, items.map((b) => `- ${b}`).join('\n'))
}
