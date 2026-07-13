import Link from 'next/link'
import { ContactsTable, type ContactUIRow } from '../../components/contacts-table'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function ContactsPage() {
  const db = await userClient()
  // ponytail: load up to 1000 and filter client-side — fine for a small-business
  // book; add server-side search + pagination if a tenant blows past that.
  const { data, error } = await db
    .from('contacts')
    .select('id, e164, first_name, last_name, external_id, notes, dnc, created_at, calls(count)')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)

  const rows: ContactUIRow[] = (data ?? []).map((c) => ({
    id: c.id,
    e164: c.e164,
    first_name: c.first_name,
    last_name: c.last_name,
    external_id: c.external_id,
    notes: c.notes,
    dnc: c.dnc,
    relatedCalls: Array.isArray(c.calls) ? ((c.calls[0] as { count?: number })?.count ?? 0) : 0,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone your agents have talked to. Auto-created from calls; import your own list to fill in
          names.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Keep contacts in sync with your CRM (HubSpot, Salesforce, and more).
        </span>
        <Link href="/integrations" className="font-medium text-brand hover:underline">
          Connect a CRM →
        </Link>
      </div>

      <ContactsTable rows={rows} />
    </div>
  )
}
