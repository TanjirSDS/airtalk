'use client'

import { useActionState } from 'react'
import { adjustCreditAction } from './actions'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

export function AdjustmentForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(adjustCreditAction, null)
  return (
    <form action={formAction} className="space-y-3">
      <select name="org" required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
        <option value="">Pick an org…</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <Input name="minutes" required placeholder="Minutes, e.g. -100 (credit)" inputMode="numeric" />
      <Input name="note" required placeholder="Audit note — why this adjustment?" minLength={5} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Applying…' : 'Apply adjustment'}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.done && <p className="text-sm text-emerald-700">{state.done}</p>}
    </form>
  )
}
