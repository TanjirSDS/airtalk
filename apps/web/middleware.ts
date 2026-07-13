import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Signature-verified or secret-guarded machine routes, plus the login/signup flows.
const PUBLIC_PREFIXES = ['/login', '/signup', '/auth', '/share', '/api/webhooks', '/api/cron', '/api/health', '/api/inngest', '/api/tools']

// Refreshes the Supabase session cookie and gates everything else behind login.
// Org resolution happens per-request in lib/org.ts (RLS does the actual scoping).
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
  // ponytail: DEV_BYPASS_AUTH=1 skips the login gate — local skeleton preview
  // only (no signed-in user exists). Delete once local signup works.
  if (process.env.DEV_BYPASS_AUTH === '1') return res
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => req.cookies.set(name, value))
          res = NextResponse.next({ request: req })
          all.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    }
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = req.nextUrl.pathname
  if (!user && !PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Phase 6: a signed-in user with no org is mid-signup — route them into the
  // flow instead of an empty app. Skipped for admins impersonating an org
  // (activeOrg validates the cookie; a spoofed one is simply ignored there).
  // ponytail: one indexed RLS select per authenticated page request — move the
  // membership bit into a JWT claim if this ever shows up in latency.
  if (
    user &&
    !path.startsWith('/signup') &&
    !path.startsWith('/api') &&
    !path.startsWith('/auth') &&
    !path.startsWith('/admin') && // support staff have no memberships
    !req.cookies.get('admin-view-org')
  ) {
    const { data: membership } = await supabase.from('org_members').select('org_id').limit(1).maybeSingle()
    if (!membership) return NextResponse.redirect(new URL('/signup/org', req.url))
  }
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
