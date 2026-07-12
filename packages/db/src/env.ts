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
  /** Optional: outcome extraction (Phase 3) is skipped when absent. */
  OPENAI_API_KEY: z.string().min(1).optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

// Lazy so `next build` succeeds without secrets; validation happens at first use.
export function getEnv(): Env {
  cached ??= schema.parse(process.env)
  return cached
}
