'use client'

import { useActionState } from 'react'
import { createOrgAction } from '../actions'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'

export function OrgForm() {
  const [state, formAction, pending] = useActionState(createOrgAction, null)
  return (
    <form action={formAction} className="space-y-3">
      <Input name="name" required placeholder="Joe's Plumbing" maxLength={80} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating…' : 'Continue'}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  )
}
