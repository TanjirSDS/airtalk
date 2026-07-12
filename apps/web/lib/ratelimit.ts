import { getEnv } from '@airtalk/db'

// Upstash sliding-window limits. Without UPSTASH_* env vars every check
// passes — rate limiting is a production knob, not a dev requirement.

type Limiter = { limit: (id: string) => Promise<{ success: boolean }> }

const WINDOWS = {
  /** Magic-link sends: brute-force + email-bombing protection. */
  auth: { tokens: 8, window: '15 m' },
  /** Webhook endpoints: flood protection ahead of signature verification. */
  webhook: { tokens: 300, window: '1 m' },
} as const

let limiters: Partial<Record<keyof typeof WINDOWS, Limiter>> | null | undefined

async function getLimiters() {
  if (limiters !== undefined) return limiters
  const env = getEnv()
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    limiters = null
    return limiters
  }
  const [{ Ratelimit }, { Redis }] = await Promise.all([
    import('@upstash/ratelimit'),
    import('@upstash/redis'),
  ])
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
  limiters = Object.fromEntries(
    Object.entries(WINDOWS).map(([kind, w]) => [
      kind,
      new Ratelimit({ redis, prefix: `rl:${kind}`, limiter: Ratelimit.slidingWindow(w.tokens, w.window) }),
    ])
  )
  return limiters
}

export async function rateLimit(kind: keyof typeof WINDOWS, id: string): Promise<{ success: boolean }> {
  try {
    const l = await getLimiters()
    if (!l) return { success: true }
    return await l[kind]!.limit(id)
  } catch (e) {
    // Redis down must not take auth/webhooks down with it — fail open.
    console.error('rate limit check failed (allowing):', e)
    return { success: true }
  }
}
