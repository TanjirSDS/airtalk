// Campaign guardrail math (rule 3: every money loop has a cap and a kill
// switch). Pure — tested in campaign-math.test.ts. Browser-safe: the wizard
// uses normalizeE164/dedupeContacts client-side for the CSV preview.

import { CONSERVATIVE_ZONES, localHour, zonesFor } from './areacode-tz'

/** Blended per-minute cost estimate (ElevenLabs credits + Twilio) for the spend cap. */
export const OUTBOUND_RATE_CENTS_PER_MIN = 13
/** Minutes assumed for a call still in flight, so the cap can't be blown mid-chunk. */
export const IN_FLIGHT_EST_MINUTES = 2
/** The legal window (TCPA): never dial before 8am or after 9pm recipient-local. */
export const LEGAL_START_HOUR = 8
export const LEGAL_END_HOUR = 21
/** Calls fired per runner chunk; one chunk per ~30s tick, so kill lands ≤30s. */
export const CHUNK_SIZE = 5

export interface CallingWindow {
  startHour: number
  endHour: number
}

/** Whatever the stored window says, it never escapes the legal 8–21 band. */
export function clampWindow(w: Partial<CallingWindow> | null | undefined): CallingWindow {
  const start = Math.min(Math.max(Math.floor(w?.startHour ?? LEGAL_START_HOUR), LEGAL_START_HOUR), LEGAL_END_HOUR - 1)
  const end = Math.min(Math.max(Math.floor(w?.endHour ?? LEGAL_END_HOUR), start + 1), LEGAL_END_HOUR)
  return { startHour: start, endHour: end }
}

/**
 * Estimated spend so far: completed call minutes at the blended rate plus a
 * flat estimate per call still in flight. Deliberately overestimates — the
 * cap stops dialing early, reconciliation (rule 5) settles the real number.
 */
export function estimatedSpendCents(completedSecs: number, inFlightCalls: number): number {
  return Math.round((completedSecs / 60) * OUTBOUND_RATE_CENTS_PER_MIN) +
    inFlightCalls * IN_FLIGHT_EST_MINUTES * OUTBOUND_RATE_CENTS_PER_MIN
}

/**
 * May this number be dialed right now? In-window in EVERY candidate timezone
 * for its area code; unknown codes must be in-window on both US coasts.
 * The end hour is exclusive: a 9pm end means the last dial starts 8:59pm local.
 */
export function isDialableNow(e164: string, window: CallingWindow, now: Date): boolean {
  const w = clampWindow(window)
  const zones = zonesFor(e164)
  const candidates = zones.length ? zones : CONSERVATIVE_ZONES
  return candidates.every((tz) => {
    const h = localHour(tz, now)
    return h >= w.startHour && h < w.endHour
  })
}

/** '(555) 010-4477' / '555-010-4477' / '+15550104477' → '+15550104477'; null if not a phone. */
export function normalizeE164(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export interface Contact {
  e164: string
  vars: Record<string, string>
}

/** Normalize + dedupe by number (first row wins); returns skipped raw values too. */
export function dedupeContacts(
  rows: { phone: string; vars: Record<string, string> }[]
): { contacts: Contact[]; invalid: string[]; duplicates: number } {
  const seen = new Set<string>()
  const contacts: Contact[] = []
  const invalid: string[] = []
  let duplicates = 0
  for (const row of rows) {
    const e164 = normalizeE164(row.phone)
    if (!e164) {
      if (row.phone.trim()) invalid.push(row.phone)
      continue
    }
    if (seen.has(e164)) {
      duplicates++
      continue
    }
    seen.add(e164)
    contacts.push({ e164, vars: row.vars })
  }
  return { contacts, invalid, duplicates }
}
