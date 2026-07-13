'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  createAlertAction,
  deleteAlertAction,
  setAlertEnabledAction,
  updateAlertAction,
  type AlertInput,
} from '../app/alerts/actions'
import {
  ALERT_METRIC_LABELS,
  ALERT_OPERATOR_LABELS,
  type AlertMetric,
  type AlertOperator,
} from '../lib/alerts-eval'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

export interface AlertRow {
  id: string
  name: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: number | string
  window_mins: number
  agent_id: string | null
  channels: { emails?: string[]; endpointIds?: string[] } | null
  enabled: boolean
  cooldown_mins: number
}
export interface EndpointOption {
  id: string
  url: string
}

const METRIC_OPTIONS = Object.entries(ALERT_METRIC_LABELS) as [AlertMetric, string][]
const OPERATOR_OPTIONS = Object.entries(ALERT_OPERATOR_LABELS) as [AlertOperator, string][]

interface Draft {
  name: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: string
  windowMins: string
  agentId: string
  cooldownMins: string
  emails: string
  endpointIds: string[]
}

// Pre-built template cards → prefill the create dialog.
const TEMPLATES: { title: string; desc: string; draft: Partial<Draft> }[] = [
  {
    title: 'High failure rate',
    desc: 'Failure rate over 20% in the last hour.',
    draft: { name: 'High failure rate', metric: 'failure_rate', operator: 'gt', threshold: '20', windowMins: '60' },
  },
  {
    title: 'Usage nearing cap',
    desc: 'Used 80% or more of the monthly minute cap.',
    draft: { name: 'Usage nearing cap', metric: 'usage_pct', operator: 'gte', threshold: '80', windowMins: '60' },
  },
  {
    title: 'Cost spike',
    desc: 'Estimated spend over $50 in the last hour.',
    draft: { name: 'Cost spike', metric: 'est_cost_cents', operator: 'gt', threshold: '5000', windowMins: '60' },
  },
  {
    title: 'Provider incident',
    desc: 'A voice/telephony provider is reporting down.',
    draft: { name: 'Provider incident', metric: 'provider_down', operator: 'gte', threshold: '1', windowMins: '15' },
  },
]

const BLANK: Draft = {
  name: '',
  metric: 'failure_rate',
  operator: 'gt',
  threshold: '',
  windowMins: '60',
  agentId: '',
  cooldownMins: '60',
  emails: '',
  endpointIds: [],
}

function draftFromRow(a: AlertRow): Draft {
  return {
    name: a.name,
    metric: a.metric,
    operator: a.operator,
    threshold: String(a.threshold),
    windowMins: String(a.window_mins),
    agentId: a.agent_id ?? '',
    cooldownMins: String(a.cooldown_mins),
    emails: (a.channels?.emails ?? []).join(', '),
    endpointIds: a.channels?.endpointIds ?? [],
  }
}

export function AlertsManager({
  alerts,
  agents,
  endpoints,
}: {
  alerts: AlertRow[]
  agents: { id: string; name: string }[]
  endpoints: EndpointOption[]
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [deleteTarget, setDeleteTarget] = useState<AlertRow | null>(null)
  const [pending, startTransition] = useTransition()

  const agentName = (id: string | null) => (id ? (agents.find((a) => a.id === id)?.name ?? 'Unknown agent') : 'All agents')

  function openCreate(prefill?: Partial<Draft>) {
    setEditingId(null)
    setDraft({ ...BLANK, ...prefill })
    setOpen(true)
  }
  function openEdit(a: AlertRow) {
    setEditingId(a.id)
    setDraft(draftFromRow(a))
    setOpen(true)
  }
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function save() {
    const input: AlertInput = {
      name: draft.name,
      metric: draft.metric,
      operator: draft.operator,
      threshold: Number(draft.threshold),
      windowMins: Number(draft.windowMins),
      agentId: draft.agentId || null,
      cooldownMins: Number(draft.cooldownMins),
      channels: {
        emails: draft.emails.split(',').map((e) => e.trim()).filter(Boolean),
        endpointIds: draft.endpointIds,
      },
    }
    startTransition(async () => {
      const res = editingId ? await updateAlertAction(editingId, input) : await createAlertAction(input)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(editingId ? 'Alert updated' : 'Alert created')
        setOpen(false)
      }
    })
  }

  function toggle(a: AlertRow, enabled: boolean) {
    startTransition(async () => {
      const res = await setAlertEnabledAction(a.id, enabled)
      if (res?.error) toast.error(res.error)
    })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    startTransition(async () => {
      const res = await deleteAlertAction(deleteTarget.id)
      if (res?.error) toast.error(res.error)
      else toast.success('Alert deleted')
      setDeleteTarget(null)
    })
  }

  return (
    <div className="space-y-6">
      {/* Template cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TEMPLATES.map((t) => (
          <button
            key={t.title}
            onClick={() => openCreate(t.draft)}
            className="rounded-xl border bg-card p-4 text-left transition-colors hover:border-brand hover:bg-muted/40"
          >
            <p className="font-medium">{t.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.desc}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your alerts</h2>
        <Button onClick={() => openCreate()}>Create Alert</Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Condition</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3 font-medium">{a.name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {ALERT_METRIC_LABELS[a.metric]} {ALERT_OPERATOR_LABELS[a.operator]} {String(a.threshold)}
                  <span className="text-xs"> · {a.window_mins}m window · {a.cooldown_mins}m cooldown</span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{agentName(a.agent_id)}</td>
                <td className="px-4 py-3">
                  <Switch checked={a.enabled} disabled={pending} onCheckedChange={(v) => toggle(a, v)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeleteTarget(a)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No alerts yet — start from a template above or create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit alert' : 'Create alert'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="alert-name">Name</Label>
              <Input id="alert-name" value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="alert-metric">Metric</Label>
                <select
                  id="alert-metric"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={draft.metric}
                  onChange={(e) => set('metric', e.target.value as AlertMetric)}
                >
                  {METRIC_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="alert-window">Time window (min)</Label>
                <Input
                  id="alert-window"
                  type="number"
                  min="1"
                  value={draft.windowMins}
                  onChange={(e) => set('windowMins', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="alert-op">Condition</Label>
                <select
                  id="alert-op"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={draft.operator}
                  onChange={(e) => set('operator', e.target.value as AlertOperator)}
                >
                  {OPERATOR_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="alert-threshold">Threshold</Label>
                <Input
                  id="alert-threshold"
                  type="number"
                  value={draft.threshold}
                  onChange={(e) => set('threshold', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="alert-agent">Filter by agent</Label>
                <select
                  id="alert-agent"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={draft.agentId}
                  onChange={(e) => set('agentId', e.target.value)}
                >
                  <option value="">All agents</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="alert-cooldown">Cooldown (min)</Label>
                <Input
                  id="alert-cooldown"
                  type="number"
                  min="0"
                  value={draft.cooldownMins}
                  onChange={(e) => set('cooldownMins', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="alert-emails">Notify emails (comma-separated)</Label>
              <Input
                id="alert-emails"
                placeholder="ops@example.com, oncall@example.com"
                value={draft.emails}
                onChange={(e) => set('emails', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notify webhook endpoints</Label>
              {endpoints.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No webhook endpoints yet — add one in Integrations to notify a URL.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {endpoints.map((ep) => (
                    <label key={ep.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.endpointIds.includes(ep.id)}
                        onChange={(e) =>
                          set(
                            'endpointIds',
                            e.target.checked
                              ? [...draft.endpointIds, ep.id]
                              : draft.endpointIds.filter((id) => id !== ep.id)
                          )
                        }
                      />
                      <span className="truncate text-muted-foreground">{ep.url}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? 'Saving…' : editingId ? 'Save changes' : 'Create alert'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This stops future notifications. Alert history is kept.</p>
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
    </div>
  )
}
