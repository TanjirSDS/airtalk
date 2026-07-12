// Pure validation for manual usage credits — money-adjacent, so it gets a test
// (rule 7). Positive delta adds used minutes; negative is a credit.

export const MAX_ADJUSTMENT_MINUTES = 10_000

export function parseAdjustment(
  minutesRaw: string,
  noteRaw: string
): { minutesDelta: number; note: string } | { error: string } {
  const minutesDelta = Number(minutesRaw)
  if (!Number.isFinite(minutesDelta) || minutesDelta === 0) {
    return { error: 'Minutes must be a non-zero number (negative = credit).' }
  }
  if (Math.abs(minutesDelta) > MAX_ADJUSTMENT_MINUTES) {
    return { error: `Keep adjustments under ${MAX_ADJUSTMENT_MINUTES} minutes.` }
  }
  const note = noteRaw.trim()
  if (note.length < 5) return { error: 'Write an audit note (at least 5 characters).' }
  return { minutesDelta, note }
}
