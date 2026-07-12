'use client'

import { useActionState } from 'react'
import { sendMagicLinkAction, type MagicLinkState } from '../app/auth/actions'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function MagicLinkForm({ mode, initialError }: { mode: 'login' | 'signup'; initialError?: string }) {
  const [state, formAction, pending] = useActionState<MagicLinkState | null, FormData>(
    sendMagicLinkAction,
    null
  )
  if (state?.sent) {
    return (
      <p className="text-sm">
        Check your email — the link {mode === 'signup' ? 'continues your setup' : 'signs you in'}.
      </p>
    )
  }
  const error = state?.error ?? initialError
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="mode" value={mode} />
      <Input type="email" name="email" required placeholder="you@business.com" />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : mode === 'signup' ? 'Create your account' : 'Send magic link'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
