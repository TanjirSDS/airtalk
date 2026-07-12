import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from './env'

// Service-role client: server-side only (webhooks, scripts, jobs). Never import client-side.
export function serviceClient(): SupabaseClient {
  const env = getEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}
