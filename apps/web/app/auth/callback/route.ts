import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { userClient } from '../../../lib/supabase-server'

// Magic-link landing: PKCE links carry ?code=, OTP-template links carry
// ?token_hash=&type=. Route handlers can write cookies, so the session lands here.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const supabase = await userClient()

  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('missing code or token_hash') }

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }
  return NextResponse.redirect(`${origin}/dashboard`)
}
