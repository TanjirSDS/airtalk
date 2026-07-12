'use client'

import Papa from 'papaparse'
import { useMemo, useState, useTransition } from 'react'
import { createCampaignAction } from '../app/campaigns/actions'
import {
  dedupeContacts,
  IN_FLIGHT_EST_MINUTES,
  LEGAL_END_HOUR,
  LEGAL_START_HOUR,
  OUTBOUND_RATE_CENTS_PER_MIN,
} from '../lib/campaign-math'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'

type Row = Record<string, string>

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`

export function CampaignWizard({ agents }: { agents: { id: string; name: string }[] }) {
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [phoneCol, setPhoneCol] = useState('')
  const [startHour, setStartHour] = useState(9)
  const [endHour, setEndHour] = useState(20)
  const [capDollars, setCapDollars] = useState(25)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onFile(file: File) {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const cols = res.meta.fields ?? []
        setColumns(cols)
        setRows(res.data)
        setPhoneCol(cols.find((c) => /phone|number|mobile|cell/i.test(c)) ?? cols[0] ?? '')
      },
      error: (e) => setError(`CSV parse failed: ${e.message}`),
    })
  }

  // Everything except the phone column rides along as dynamic variables the
  // agent can use in conversation ({{first_name}} etc.).
  const preview = useMemo(() => {
    if (!phoneCol || !rows.length) return null
    return dedupeContacts(
      rows.map((r) => {
        const { [phoneCol]: phone, ...vars } = r
        return { phone: phone ?? '', vars }
      })
    )
  }, [rows, phoneCol])

  const estimatedMaxCents = (preview?.contacts.length ?? 0) * IN_FLIGHT_EST_MINUTES * OUTBOUND_RATE_CENTS_PER_MIN

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await createCampaignAction({
        name,
        agentId,
        window: { startHour, endHour },
        spendCapCents: Math.round(capDollars * 100),
        consent,
        contacts: rows.map((r) => {
          const { [phoneCol]: phone, ...vars } = r
          return { phone: phone ?? '', vars }
        }),
      })
      if (res?.error) setError(res.error)
    })
  }

  const ready = name.trim() && agentId && consent && (preview?.contacts.length ?? 0) > 0

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="c-name">Campaign name</Label>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="July follow-ups" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-agent">Agent</Label>
          <Select id="c-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="c-csv">Contact list (CSV with a header row)</Label>
        <Input
          id="c-csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </div>

      {columns.length > 0 && (
        <>
          <div className="space-y-1">
            <Label htmlFor="c-phonecol">Phone number column</Label>
            <Select id="c-phonecol" value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)} className="w-56">
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Every other column is passed to the agent as a variable it can use mid-call.
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  {columns.map((c) => (
                    <th key={c} className={`px-3 py-2 font-medium ${c === phoneCol ? 'text-primary' : ''}`}>
                      {c}
                      {c === phoneCol && ' (phone)'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-2">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview && (
            <p className="text-sm text-muted-foreground">
              {preview.contacts.length} callable contact{preview.contacts.length === 1 ? '' : 's'}
              {preview.duplicates > 0 && ` · ${preview.duplicates} duplicate${preview.duplicates === 1 ? '' : 's'} removed`}
              {preview.invalid.length > 0 && ` · ${preview.invalid.length} invalid number${preview.invalid.length === 1 ? '' : 's'} skipped`}
              . Numbers on your do-not-call list are scrubbed automatically on save.
            </p>
          )}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="c-start">Calling window start</Label>
          <Select id="c-start" value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
            {Array.from({ length: LEGAL_END_HOUR - LEGAL_START_HOUR }, (_, i) => LEGAL_START_HOUR + i).map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-end">Calling window end</Label>
          <Select id="c-end" value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
            {Array.from({ length: LEGAL_END_HOUR - LEGAL_START_HOUR }, (_, i) => LEGAL_START_HOUR + 1 + i).map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">Recipient-local, hard-capped to 8am–9pm.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="c-cap">Spend cap (USD)</Label>
          <Input
            id="c-cap"
            type="number"
            min="1"
            step="1"
            value={capDollars}
            onChange={(e) => setCapDollars(Number(e.target.value))}
          />
          {estimatedMaxCents > 0 && (
            <p className="text-xs text-muted-foreground">
              Estimated max: ${(estimatedMaxCents / 100).toFixed(2)} (~{IN_FLIGHT_EST_MINUTES} min/call at $
              {(OUTBOUND_RATE_CENTS_PER_MIN / 100).toFixed(2)}/min)
            </p>
          )}
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I attest that every contact on this list gave <strong>prior express consent</strong> to
          receive calls from my business at the number provided, and that this list contains no
          numbers I am required not to call. The attestation is recorded with my account and a
          timestamp.
        </span>
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={!ready || pending}>
        {pending ? 'Creating…' : 'Create campaign (as draft)'}
      </Button>
    </div>
  )
}
