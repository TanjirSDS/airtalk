import { z } from 'zod'

// The single env schema for the whole app (CLAUDE.md: "validated with zod in a single env.ts").
// Next.js loads .env.local itself; node scripts load it via dotenv before calling getEnv().
const schema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Browser-side Supabase auth (Phase 4). Client components read process.env
   *  directly (Next.js inlines NEXT_PUBLIC_*); listed here so server code and
   *  scripts fail fast when they're missing. */
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  /** Stripe billing (Phase 5). Webhook secret comes from the endpoint config
   *  (dashboard or `stripe listen`). */
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  /** Optional: outcome extraction (Phase 3) is skipped when absent. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Optional: shared secret for /api/cron/* (Vercel sends it as a Bearer token). */
  CRON_SECRET: z.string().min(1).optional(),
  /** Optional: reconciliation discrepancies are reported to Sentry when set. */
  SENTRY_DSN: z.string().url().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

// Lazy so `next build` succeeds without secrets; validation happens at first use.
export function getEnv(): Env {
  cached ??= schema.parse(process.env)
  return cached
}
