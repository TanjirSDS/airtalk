import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@airtalk/db'

// RLS-scoped client bound to the signed-in user's cookies. All user-facing
// reads/writes go through this so Postgres enforces org isolation; only
// webhooks/cron/scripts use serviceClient().
export async function userClient(): Promise<SupabaseClient> {
  const store = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (all) => {
          try {
            all.forEach(({ name, value, options }) => store.set(name, value, options))
          } catch {
            // Server Components can't write cookies; middleware refreshes the session.
          }
        },
      },
    }
  )
}
