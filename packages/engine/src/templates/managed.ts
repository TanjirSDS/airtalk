// Phase 11: managed prompt sections. The freeform system prompt is the source of
// truth, so learning-merge and the Agent Handbook edit it by inserting / replacing
// / removing whole "## Heading" blocks rather than mutating a profile. Pure and
// browser-safe (see shared.ts) — the builder UI edits sections client-side too.

const HEADING_RE = /^##\s/

/** [start, end) line range of a "## Heading" block: the heading line through the
 *  line before the next "## " heading (or EOF). null if the heading is absent. */
function findSection(lines: string[], heading: string): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

/** Trimmed body of a managed section, or null if the heading isn't present. */
export function getSection(prompt: string, heading: string): string | null {
  const lines = prompt.split('\n')
  const sec = findSection(lines, heading)
  if (!sec) return null
  return lines.slice(sec.start + 1, sec.end).join('\n').trim()
}

/**
 * Replace a section's body, append the section to the prompt end if it's absent,
 * or (empty body) remove it entirely. Whitespace is normalized so repeated
 * set/remove cycles stay stable.
 */
export function setSection(prompt: string, heading: string, body: string): string {
  const b = body.trim()
  const lines = prompt.split('\n')
  const sec = findSection(lines, heading)
  let out: string[]
  if (!sec) {
    if (!b) return prompt
    out = [...lines, '', heading, b]
  } else if (!b) {
    out = [...lines.slice(0, sec.start), ...lines.slice(sec.end)]
  } else {
    out = [...lines.slice(0, sec.start), heading, b, '', ...lines.slice(sec.end)]
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function removeSection(prompt: string, heading: string): string {
  return setSection(prompt, heading, '')
}

export function hasSection(prompt: string, heading: string): boolean {
  return getSection(prompt, heading) !== null
}
