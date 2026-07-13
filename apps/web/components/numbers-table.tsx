'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  assignNumberAction,
  buyNumberAction,
  importSipNumberAction,
  releaseNumberAction,
} from '../app/numbers/actions'
import { MoreIcon, PlusIcon } from './icons'
import { NumberPicker } from './number-picker'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'

export interface NumberRow {
  id: string
  e164: string
  provider: 'twilio' | 'sip'
  status: string
  agentId: string | null
  createdAt: string | null
}
export interface NumbersAgent {
  id: string
  name: string
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

export function NumbersTable({
  numbers,
  agents,
  atLimit,
  maxNumbers,
}: {
  numbers: NumberRow[]
  agents: NumbersAgent[]
  atLimit: boolean
  maxNumbers: number
}) {
  const [buyOpen, setBuyOpen] = useState(false)
  const [sipOpen, setSipOpen] = useState(false)
  const [releaseTarget, setReleaseTarget] = useState<NumberRow | null>(null)
  const [pending, startTransition] = useTransition()

  function assign(numberId: string, agentId: string | null) {
    startTransition(async () => {
      const res = await assignNumberAction(numberId, agentId)
      if (res?.error) toast.error(res.error)
      else toast.success(agentId ? 'Agent assigned' : 'Number unassigned')
    })
  }

  function onSip(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    startTransition(async () => {
      const res = await importSipNumberAction(new FormData(form))
      if (res?.error) toast.error(res.error)
      else {
        toast.success('SIP number connected')
        setSipOpen(false)
        form.reset()
      }
    })
  }

  function confirmRelease() {
    if (!releaseTarget) return
    const n = releaseTarget
    startTransition(async () => {
      const res = await releaseNumberAction(n.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(`Released ${n.e164}`)
        setReleaseTarget(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        {atLimit && (
          <span className="text-xs text-muted-foreground">
            Plan limit reached ({maxNumbers}). Release one or upgrade.
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={atLimit}>
              <PlusIcon className="h-4 w-4" />
              Add number
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setBuyOpen(true)}>Buy new number</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSipOpen(true)}>Connect via SIP trunk</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Assigned agent</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Added</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {numbers.map((n) => {
              const released = n.status === 'released'
              return (
                <tr key={n.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium">{n.e164}</td>
                  <td className="px-4 py-3">
                    <Select
                      value={n.agentId ?? ''}
                      disabled={released || pending}
                      className="h-9 max-w-[14rem]"
                      onChange={(e) => assign(n.id, e.target.value || null)}
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={n.provider === 'twilio' ? 'secondary' : 'outline'}>{n.provider}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={released ? 'outline' : 'secondary'}>{n.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(n.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {!released && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label="Number actions">
                            <MoreIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setReleaseTarget(n)}
                          >
                            Release
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              )
            })}
            {numbers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No numbers yet. Buy one or connect a SIP trunk.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Buy new (reuses the signup number picker, bare, without its redirect) */}
      <Dialog open={buyOpen} onOpenChange={(o) => !o && setBuyOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buy a new number</DialogTitle>
            <DialogDescription>
              Search US local numbers by area code. The number arrives unassigned — pick an agent
              from the table.
            </DialogDescription>
          </DialogHeader>
          <NumberPicker
            bare
            buyAction={buyNumberAction}
            onBought={() => {
              toast.success('Number added')
              setBuyOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Connect via SIP trunk */}
      <Dialog open={sipOpen} onOpenChange={(o) => !o && setSipOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect via SIP trunk</DialogTitle>
            <DialogDescription>Register a number you own through your SIP provider.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSip} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sip-label">Label</Label>
                <Input id="sip-label" name="label" placeholder="HQ trunk" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sip-e164">Phone number</Label>
                <Input id="sip-e164" name="e164" placeholder="+15551234567" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sip-address">SIP server address</Label>
              <Input id="sip-address" name="address" placeholder="sip.yourprovider.com" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sip-transport">Transport</Label>
                <Select id="sip-transport" name="transport" defaultValue="auto">
                  <option value="auto">Auto</option>
                  <option value="udp">UDP</option>
                  <option value="tcp">TCP</option>
                  <option value="tls">TLS</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sip-allowed">Allowed IPs (optional)</Label>
                <Input id="sip-allowed" name="allowedAddresses" placeholder="10.0.0.0/24, 1.2.3.4" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sip-username">Username (optional)</Label>
                <Input id="sip-username" name="username" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sip-password">Password (optional)</Label>
                <Input id="sip-password" name="password" type="password" autoComplete="off" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSipOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Connecting…' : 'Connect'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Release confirm */}
      <Dialog open={!!releaseTarget} onOpenChange={(o) => !o && setReleaseTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Release number</DialogTitle>
            <DialogDescription>
              This detaches {releaseTarget?.e164}, removes it from the provider
              {releaseTarget?.provider === 'twilio' ? ', and stops its Twilio charge' : ''}. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRelease} disabled={pending}>
              {pending ? 'Releasing…' : 'Release number'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
