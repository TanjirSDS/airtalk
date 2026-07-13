'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { updateContactAction } from '../app/contacts/actions'
import type { CallDetail as CallDetailData } from '../lib/call-detail-data'
import { formatCents, formatDuration } from '../lib/call-filters'
import { OUTCOME_COLORS, type Outcome } from '../lib/outcome'
import { CallPlayer } from './call-player'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

interface Criterion {
  name: string
  result: string
  rationale?: string
}
interface Analysis {
  success?: boolean
  criteria?: Criterion[]
  data?: Record<string, unknown>
  sentiment?: string
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

export function CallDetail({ detail }: { detail: CallDetailData }) {
  const { call, agentName, contact, campaign, logs, backfilled } = detail
  const analysis = (call.analysis as Analysis | null) ?? null
  const outcome = call.outcome as Outcome | null

  const meta: [string, string][] = [
    ['Agent', agentName ?? '—'],
    ['Direction', call.direction ?? '—'],
    ['From → To', `${call.from_e164 ?? '?'} → ${call.to_e164 ?? '?'}`],
    ['Started', fmtDate(call.started_at)],
    ['Duration', formatDuration(call.duration_secs)],
    ['Cost', formatCents(call.cost_cents)],
    ['Status', call.status ?? '—'],
  ]

  const dataEntries = analysis?.data ? Object.entries(analysis.data) : []
  const varEntries = campaign?.vars ? Object.entries(campaign.vars) : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Call detail</h2>
          {outcome && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: OUTCOME_COLORS[outcome] ?? '#77777c' }}
            >
              {String(outcome).replace('_', ' ')}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Summary */}
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Summary</h3>
        <p className={`text-sm ${call.summary ? '' : 'text-muted-foreground'}`}>
          {call.summary ?? 'No summary extracted for this call.'}
        </p>
      </section>

      {/* Conversation analysis */}
      {analysis && (analysis.criteria?.length || analysis.sentiment || analysis.success != null) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Conversation analysis</h3>
          {analysis.sentiment && (
            <p className="text-sm text-muted-foreground">
              Sentiment: <span className="font-medium text-foreground">{analysis.sentiment}</span>
            </p>
          )}
          <ul className="space-y-2">
            {(analysis.criteria ?? []).map((c, i) => {
              const pass = /succ|pass|true|yes/i.test(c.result)
              return (
                <li key={i} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        pass ? 'bg-live/15 text-live' : 'bg-destructive/15 text-destructive'
                      }`}
                    >
                      {c.result}
                    </span>
                    <span className="font-medium">{c.name.replace(/_/g, ' ')}</span>
                  </div>
                  {c.rationale && <p className="mt-1 text-muted-foreground">{c.rationale}</p>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Linked contact (item 6) */}
      <ContactPanel contact={contact} />

      {/* Tabs. ponytail: CallPlayer bundles the audio + click-to-seek transcript,
          so it IS the Transcription tab (default) rather than a second audio element. */}
      <Tabs defaultValue="transcription">
        <TabsList>
          <TabsTrigger value="transcription">Transcription</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="transcription">
          <CallPlayer
            src={call.recording_url ?? `/api/calls/${call.id}/audio`}
            transcript={Array.isArray(call.transcript) ? call.transcript : []}
          />
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          {dataEntries.length === 0 && varEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">No extracted data for this call.</p>
          )}
          {dataEntries.length > 0 && (
            <KeyValues title="Extracted data" entries={dataEntries} />
          )}
          {varEntries.length > 0 && (
            <KeyValues title="Campaign variables" entries={varEntries} subtitle={campaign?.name ?? undefined} />
          )}
        </TabsContent>

        <TabsContent value="logs" className="space-y-2">
          {backfilled && (
            <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">
              No webhook events — this call was backfilled by nightly reconciliation.
            </p>
          )}
          {logs.length > 0 && (
            <ol className="space-y-1 text-sm">
              {logs.map((l, i) => (
                <li key={i} className="flex items-center justify-between rounded-md border px-2 py-1.5">
                  <span className="font-mono text-xs">{l.type}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtDate(l.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function KeyValues({
  title,
  subtitle,
  entries,
}: {
  title: string
  subtitle?: string
  entries: [string, unknown][]
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold">
        {title}
        {subtitle && <span className="ml-2 font-normal text-muted-foreground">· {subtitle}</span>}
      </h4>
      <dl className="mt-1 divide-y rounded-md border text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-3 py-1.5">
            <dt className="w-40 shrink-0 text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
            <dd className="break-words">{v == null ? '—' : String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ContactPanel({ contact }: { contact: CallDetailData['contact'] }) {
  const [form, setForm] = useState(contact)
  const [pending, startTransition] = useTransition()

  if (!contact || !form) {
    return (
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Contact</h3>
        <p className="text-sm text-muted-foreground">No contact linked to this call.</p>
      </section>
    )
  }

  function save() {
    if (!form) return
    startTransition(async () => {
      const res = await updateContactAction(form.id, {
        first_name: form.first_name,
        last_name: form.last_name,
        external_id: form.external_id,
        notes: form.notes,
        dnc: form.dnc,
      })
      if (res.error) toast.error(res.error)
      else toast.success('Contact saved')
    })
  }

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Contact · {form.e164}</h3>
        {form.dnc && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs font-medium text-destructive">DNC</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" value={form.first_name} onChange={(v) => setForm({ ...form, first_name: v })} />
        <Field label="Last name" value={form.last_name} onChange={(v) => setForm({ ...form, last_name: v })} />
        <Field label="Contact ID" value={form.external_id} onChange={(v) => setForm({ ...form, external_id: v })} />
        <label className="flex items-end gap-2 text-sm">
          <Switch checked={form.dnc} onCheckedChange={(v) => setForm({ ...form, dnc: v })} />
          <span>Do not call</span>
        </label>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Notes</Label>
        <Textarea
          rows={2}
          value={form.notes ?? ''}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
      <Button size="sm" onClick={save} disabled={pending}>
        {pending ? 'Saving…' : 'Save contact'}
      </Button>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
