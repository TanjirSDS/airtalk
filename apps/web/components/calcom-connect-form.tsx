'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { setAgentBookingAction } from '../app/agents/actions'
import { Switch } from './ui/switch'

/**
 * Per-agent "live booking" toggle in the builder's Functions section. The org's
 * Cal.com credentials are managed on /integrations; this only flips the
 * check_availability_and_book tool on this one agent.
 */
export function CalcomConnectForm({
  agentId,
  orgConnected,
  bookingEnabled,
}: {
  agentId: string
  orgConnected: boolean
  bookingEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(bookingEnabled)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(next: boolean) {
    setStatus(null)
    setEnabled(next) // optimistic
    startTransition(async () => {
      const res = await setAgentBookingAction(agentId, next)
      if (res?.error) {
        setEnabled(!next) // revert
        setStatus(`Error: ${res.error}`)
      } else {
        setStatus(next ? 'Live booking on — this agent books real slots.' : 'Live booking off — back to message-taking.')
      }
    })
  }

  if (!orgConnected) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a Cal.com calendar in{' '}
        <Link href="/integrations" className="text-brand underline">
          Integrations
        </Link>{' '}
        to let this agent book real appointments during the call.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm">Book real appointments on this agent&apos;s calls</span>
        <Switch checked={enabled} disabled={pending} onCheckedChange={toggle} />
      </div>
      {status && (
        <p className={`text-sm ${status.startsWith('Error') ? 'text-destructive' : 'text-emerald-700'}`}>{status}</p>
      )}
    </div>
  )
}
