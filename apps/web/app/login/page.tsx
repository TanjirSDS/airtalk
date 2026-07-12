'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'

// Magic-link only (Phase 4 spec) — no signup funnel; orgs are created by admin script.
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Surface ?error= from a failed/expired magic-link callback.
  useEffect(() => {
    const err = new URLSearchParams(location.search).get('error')
    if (err) setError(err)
  }, [])

  async function sendLink(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // No signup funnel yet: only admin-created users can log in.
      options: { emailRedirectTo: `${location.origin}/auth/callback`, shouldCreateUser: false },
    })
    setPending(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Airtalk</CardTitle>
          <CardDescription>We&apos;ll email you a magic link.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm">Check your email — the link signs you in.</p>
          ) : (
            <form onSubmit={sendLink} className="space-y-3">
              <Input
                type="email"
                required
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? 'Sending…' : 'Send magic link'}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
