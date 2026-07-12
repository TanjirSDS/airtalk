import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Signature-verified or secret-guarded machine routes, plus the login flow itself.
const PUBLIC_PREFIXES = ['/login', '/auth', '/api/webhooks', '/api/cron', '/api/health']

// Refreshes the Supabase session cookie and gates everything else behind login.
// Org resolution happens per-request in lib/org.ts (RLS does the actual scoping).
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req })
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
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
