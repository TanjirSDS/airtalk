'use client'

import { useState, useTransition } from 'react'
import { connectCalcomAction } from '../app/agents/actions'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

export function CalcomConnectForm({
  agentId,
  connected,
  eventTypeId,
}: {
  agentId: string
  connected: boolean
  eventTypeId: number | null
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(formData: FormData) {
    setStatus(null)
    startTransition(async () => {
      const res = await connectCalcomAction(agentId, formData)
      setStatus(res?.error ? `Error: ${res.error}` : 'Connected — this agent now books real slots.')
    })
  }

  return (
    <form action={submit} className="space-y-3">
      {connected && (
        <p className="text-sm text-emerald-700">
          Calendar connected (event type {eventTypeId}). Saving again replaces the key.
        </p>
      )}
      <div className="space-y-1">
        <Label htmlFor="calcom-key">Cal.com API key</Label>
        <Input id="calcom-key" name="apiKey" type="password" placeholder="cal_live_…" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="calcom-event-type">Event type id</Label>
        <Input id="calcom-event-type" name="eventTypeId" type="number" min="1" required />
        <p className="text-xs text-muted-foreground">
          A wrong id lists your available event types in the error.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Connecting…' : connected ? 'Update connection' : 'Connect calendar'}
      </Button>
      {status && (
        <p className={`text-sm ${status.startsWith('Error') ? 'text-destructive' : 'text-emerald-700'}`}>
          {status}
        </p>
      )}
    </form>
  )
}
