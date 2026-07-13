'use client'

import Papa from 'papaparse'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  getContactCallsAction,
  importContactsAction,
  updateContactAction,
  type ImportRow,
  type RelatedCall,
} from '../app/contacts/actions'
import { UploadIcon } from './icons'
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
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
import { Switch } from './ui/switch'
import { Textarea } from './ui/textarea'

export interface ContactUIRow {
  id: string
  e164: string
  first_name: string | null
  last_name: string | null
  external_id: string | null
  notes: string | null
  dnc: boolean
  relatedCalls: number
}

const guess = (cols: string[], re: RegExp) => cols.find((c) => re.test(c)) ?? ''

export function ContactsTable({ rows }: { rows: ContactUIRow[] }) {
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [detail, setDetail] = useState<ContactUIRow | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.e164, r.first_name, r.last_name, r.external_id].some((v) => v?.toLowerCase().includes(q))
    )
  }, [rows, query])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, number, or ID"
          className="max-w-xs"
        />
        <Button onClick={() => setImportOpen(true)}>
          <UploadIcon className="h-4 w-4" />
          Import CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">First name</th>
              <th className="px-4 py-3">Last name</th>
              <th className="px-4 py-3">Contact ID</th>
              <th className="px-4 py-3">Calls</th>
              <th className="px-4 py-3">DNC</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                onClick={() => setDetail(c)}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-3 font-medium tabular-nums">{c.e164}</td>
                <td className="px-4 py-3">{c.first_name ?? '—'}</td>
                <td className="px-4 py-3">{c.last_name ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.external_id ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{c.relatedCalls}</td>
                <td className="px-4 py-3">
                  {c.dnc && <Badge variant="destructive">DNC</Badge>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? 'No contacts yet — they appear as calls come in.' : 'No matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ContactDetail contact={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [map, setMap] = useState({ phone: '', first: '', last: '', external: '', notes: '' })
  const [pending, startTransition] = useTransition()

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const c = res.meta.fields ?? []
        setCols(c)
        setRows(res.data)
        setMap({
          phone: guess(c, /phone|number|mobile|cell|tel/i) || c[0] || '',
          first: guess(c, /first|fname|given/i),
          last: guess(c, /last|lname|surname|family/i),
          external: guess(c, /id|external|crm|ref/i),
          notes: guess(c, /note|comment/i),
        })
      },
      error: (e) => toast.error(`CSV parse failed: ${e.message}`),
    })
  }

  function submit() {
    if (!map.phone) return
    const payload: ImportRow[] = rows.map((r) => ({
      e164: r[map.phone] ?? '',
      first_name: map.first ? r[map.first] : undefined,
      last_name: map.last ? r[map.last] : undefined,
      external_id: map.external ? r[map.external] : undefined,
      notes: map.notes ? r[map.notes] : undefined,
    }))
    startTransition(async () => {
      const res = await importContactsAction(payload)
      if (res.error) toast.error(res.error)
      else {
        toast.success(`Imported ${res.imported} contact${res.imported === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped}` : ''}`)
        setRows([])
        setCols([])
        onClose()
        router.refresh()
      }
    })
  }

  const colSelect = (key: keyof typeof map, label: string, optional = false) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={map[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
        {optional && <option value="">—</option>}
        {cols.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            Upload a CSV with a header row. Existing contacts merge on phone number — names update, the
            do-not-call flag is never cleared.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="contacts-csv">CSV file</Label>
            <Input
              id="contacts-csv"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </div>
          {cols.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">{rows.length} rows found. Map your columns:</p>
              <div className="grid grid-cols-2 gap-3">
                {colSelect('phone', 'Phone number')}
                {colSelect('first', 'First name', true)}
                {colSelect('last', 'Last name', true)}
                {colSelect('external', 'Contact ID', true)}
                {colSelect('notes', 'Notes', true)}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !map.phone || rows.length === 0}>
            {pending ? 'Importing…' : `Import ${rows.length || ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContactDetail({ contact, onClose }: { contact: ContactUIRow | null; onClose: () => void }) {
  const router = useRouter()
  const [form, setForm] = useState<ContactUIRow | null>(contact)
  const [calls, setCalls] = useState<RelatedCall[]>([])
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Reseed + load related calls when a different contact opens.
  if (contact && openedFor !== contact.id) {
    setOpenedFor(contact.id)
    setForm(contact)
    setCalls([])
    getContactCallsAction(contact.id).then(setCalls)
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
      else {
        toast.success('Contact saved')
        router.refresh()
      }
    })
  }

  return (
    <Sheet open={!!contact} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{form?.e164}</SheetTitle>
        </SheetHeader>
        {form && (
          <div className="mt-4 space-y-5">
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
              <Textarea rows={3} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Related calls ({calls.length})</h3>
              {calls.length === 0 ? (
                <p className="text-sm text-muted-foreground">No calls yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {calls.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/calls?call=${c.id}`}
                        className="flex items-center justify-between rounded-md border px-2 py-1.5 hover:bg-accent"
                      >
                        <span className="text-muted-foreground">
                          {c.started_at ? new Date(c.started_at).toLocaleDateString() : '—'} · {c.direction ?? '—'}
                        </span>
                        {c.outcome && <Badge variant="secondary">{c.outcome.replace('_', ' ')}</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
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
