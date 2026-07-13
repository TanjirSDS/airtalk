'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  connectCalcomAction,
  createWebhookEndpointAction,
  deleteWebhookEndpointAction,
  disconnectCalcomAction,
  registerInterestAction,
  setWebhookEndpointEnabledAction,
} from '../app/integrations/actions'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

export interface EndpointRow {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
  latestStatus: string | null
}

const EVENT_TYPES = ['call.completed', 'alert.fired'] as const
const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  pending: 'bg-muted-foreground/40',
  failed: 'bg-amber-500',
  dead: 'bg-destructive',
}
const CRM = [
  { id: 'hubspot', name: 'HubSpot', desc: 'Sync contacts and log calls to HubSpot CRM.' },
  { id: 'salesforce', name: 'Salesforce', desc: 'Sync contacts and log calls to Salesforce.' },
]

export function IntegrationsManager({
  tab,
  isOwner,
  calcom,
  endpoints,
  interest,
}: {
  tab: 'connected' | 'available'
  isOwner: boolean
  calcom: { connected: boolean; eventTypeId: number | null }
  endpoints: EndpointRow[]
  interest: string[]
}) {
  if (tab === 'available') return <AvailableTab interest={interest} />
  return (
    <div className="space-y-8">
      <CalcomCard isOwner={isOwner} calcom={calcom} />
      <WebhooksSection endpoints={endpoints} />
    </div>
  )
}

function CalcomCard({ isOwner, calcom }: { isOwner: boolean; calcom: { connected: boolean; eventTypeId: number | null } }) {
  const [pending, startTransition] = useTransition()

  function connect(formData: FormData) {
    startTransition(async () => {
      const res = await connectCalcomAction(formData)
      if (res?.error) toast.error(res.error)
      else toast.success('Cal.com connected — enable booking per agent in the builder.')
    })
  }
  function disconnect() {
    startTransition(async () => {
      const res = await disconnectCalcomAction()
      if (res?.error) toast.error(res.error)
      else toast.success('Cal.com disconnected')
    })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Calendar</h2>
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Cal.com</p>
            <p className="text-sm text-muted-foreground">
              {calcom.connected
                ? `Connected (event type ${calcom.eventTypeId}). Booking agents can book real slots.`
                : 'Connect a calendar so booking agents can schedule appointments live during a call.'}
            </p>
          </div>
          {calcom.connected && (
            <Button variant="outline" size="sm" onClick={disconnect} disabled={!isOwner || pending}>
              Disconnect
            </Button>
          )}
        </div>

        {!isOwner ? (
          <p className="mt-4 text-xs text-muted-foreground">Only the workspace owner can manage the calendar connection.</p>
        ) : (
          <form action={connect} className="mt-4 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="calcom-key">Cal.com API key</Label>
              <Input id="calcom-key" name="apiKey" type="password" placeholder="cal_live_…" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="calcom-event">Event type id</Label>
              <Input id="calcom-event" name="eventTypeId" type="number" min="1" required />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Connecting…' : calcom.connected ? 'Update' : 'Connect'}
            </Button>
          </form>
        )}
        {isOwner && (
          <p className="mt-2 text-xs text-muted-foreground">A wrong id lists your available event types in the error.</p>
        )}
      </div>
    </section>
  )
}

function WebhooksSection({ endpoints }: { endpoints: EndpointRow[] }) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['call.completed'])
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EndpointRow | null>(null)

  function reset() {
    setUrl('')
    setEvents(['call.completed'])
    setNewSecret(null)
  }

  function create() {
    startTransition(async () => {
      const res = await createWebhookEndpointAction({ url, events })
      if (res?.error) toast.error(res.error)
      else {
        setNewSecret(res.secret ?? '')
        toast.success('Endpoint added')
      }
    })
  }
  function toggle(ep: EndpointRow, enabled: boolean) {
    startTransition(async () => {
      const res = await setWebhookEndpointEnabledAction(ep.id, enabled)
      if (res?.error) toast.error(res.error)
      else toast.success(enabled ? 'Endpoint enabled' : 'Endpoint disabled — deliveries stopped')
    })
  }
  function confirmDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const res = await deleteWebhookEndpointAction(deleteTarget.id)
      if (res?.error) toast.error(res.error)
      else toast.success('Endpoint deleted')
      setDeleteTarget(null)
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Webhook endpoints</h2>
        <Button
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          Add Integration
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Endpoint</th>
              <th className="px-4 py-3">Events</th>
              <th className="px-4 py-3">Last delivery</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                <td className="max-w-[280px] truncate px-4 py-3 font-medium">{ep.url}</td>
                <td className="px-4 py-3 text-muted-foreground">{ep.events.join(', ')}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[ep.latestStatus ?? ''] ?? 'bg-muted-foreground/30'}`} />
                    {ep.latestStatus ?? 'none'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Switch checked={ep.enabled} disabled={pending} onCheckedChange={(v) => toggle(ep, v)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => setDeleteTarget(ep)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {endpoints.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No endpoints yet. Add one to receive call.completed and alert.fired events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create dialog (also shows the reveal-once secret after creation) */}
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
          </DialogHeader>
          {newSecret === null ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="ep-url">Endpoint URL (https)</Label>
                <Input id="ep-url" placeholder="https://example.com/hooks/airtalk" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Events to send</Label>
                {EVENT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={events.includes(t)}
                      onChange={(e) => setEvents(e.target.checked ? [...events, t] : events.filter((x) => x !== t))}
                    />
                    <span className="font-mono text-muted-foreground">{t}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                Copy your signing secret now — it&apos;s shown once. Verify deliveries with the{' '}
                <code className="rounded bg-muted px-1">airtalk-signature</code> header.
              </p>
              <code className="block break-all rounded-md border bg-muted px-3 py-2 text-xs">{newSecret}</code>
            </div>
          )}
          <DialogFooter>
            {newSecret === null ? (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={create} disabled={pending}>
                  {pending ? 'Adding…' : 'Add endpoint'}
                </Button>
              </>
            ) : (
              <Button onClick={() => setOpen(false)}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this endpoint?</DialogTitle>
          </DialogHeader>
          <p className="break-all text-sm text-muted-foreground">{deleteTarget?.url}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function AvailableTab({ interest }: { interest: string[] }) {
  const [pending, startTransition] = useTransition()
  const [joined, setJoined] = useState<string[]>(interest)

  function register(provider: string) {
    setJoined((j) => (j.includes(provider) ? j : [...j, provider])) // optimistic
    startTransition(async () => {
      const res = await registerInterestAction(provider)
      if (res?.error) {
        setJoined((j) => j.filter((p) => p !== provider))
        toast.error(res.error)
      } else toast.success('Thanks — we\'ll be in touch when it\'s ready.')
    })
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CRM.map((c) => {
        const done = joined.includes(c.id)
        return (
          <div key={c.id} className="flex items-start justify-between gap-4 rounded-xl border bg-card p-5">
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
            </div>
            <Button variant="outline" size="sm" disabled={done || pending} onClick={() => register(c.id)}>
              {done ? 'Interested ✓' : 'Register interest'}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
