// Shared between /calls (table) and /calls/export (CSV) so both always agree.

export interface CallFilters {
  agent?: string
  direction?: string
  outcome?: string
  from?: string // yyyy-mm-dd inclusive
  to?: string // yyyy-mm-dd inclusive
}

export function parseCallFilters(params: Record<string, string | string[] | undefined>): CallFilters {
  const get = (k: string) => {
    const v = params[k]
    return typeof v === 'string' && v !== '' ? v : undefined
  }
  return { agent: get('agent'), direction: get('direction'), outcome: get('outcome'), from: get('from'), to: get('to') }
}

/** Applies filters to any supabase query builder over `calls`. */
export function applyCallFilters<Q extends { eq: any; gte: any; lt: any }>(q: Q, f: CallFilters): Q {
  if (f.agent) q = q.eq('agent_id', f.agent)
  if (f.direction) q = q.eq('direction', f.direction)
  if (f.outcome) q = q.eq('outcome', f.outcome)
  if (f.from) q = q.gte('started_at', f.from)
  if (f.to) {
    const next = new Date(`${f.to}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    q = q.lt('started_at', next.toISOString()) // inclusive end day
  }
  return q
}

/** supabase-js types the `agents(name)` join as an array without generated types; runtime is an object. */
export function joinedAgentName(agents: unknown): string | null {
  const a = Array.isArray(agents) ? agents[0] : agents
  return (a as { name?: string } | null)?.name ?? null
}

export function formatDuration(secs: number | null): string {
  if (secs == null) return '—'
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}
