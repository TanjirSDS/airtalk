import { serviceClient } from '@airtalk/db'
import { AdjustmentForm } from './adjustment-form'
import { viewAsAction } from './actions'
import { requireAdmin } from '../../lib/admin'

export const dynamic = 'force-dynamic'

// Support panel: every org with plan, usage, and members; impersonation and
// manual credits. Server-side only, service client — requireAdmin gates it.
export default async function AdminPage() {
  await requireAdmin()
  const db = serviceClient()
  const period = new Date().toISOString().slice(0, 8) + '01'

  const [{ data: orgs }, { data: usage }, { data: members }, { data: adjustments }] = await Promise.all([
    db
      .from('orgs')
      .select('id, name, plan_id, overage_policy, payment_failed_at, created_at, stripe_subscription_id')
      .order('created_at', { ascending: false }),
    db.from('usage_periods').select('org_id, minutes_used, minutes_cap, overage_minutes').eq('period_start', period),
    db.from('org_members').select('org_id'),
    db
      .from('usage_adjustments')
      .select('org_id, minutes_delta, note, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const usageByOrg = new Map((usage ?? []).map((u) => [u.org_id, u]))
  const memberCount = new Map<string, number>()
  for (const m of members ?? []) memberCount.set(m.org_id, (memberCount.get(m.org_id) ?? 0) + 1)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Org</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Usage (this month)</th>
              <th className="px-3 py-2 font-medium">Members</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(orgs ?? []).map((o) => {
              const u = usageByOrg.get(o.id)
              return (
                <tr key={o.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground">{o.id}</div>
                  </td>
                  <td className="px-3 py-2">{o.plan_id}</td>
                  <td className="px-3 py-2">
                    {u
                      ? `${Math.round(u.minutes_used)} / ${u.minutes_cap} min` +
                        (u.overage_minutes > 0 ? ` (+${Math.round(u.overage_minutes)} over)` : '')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{memberCount.get(o.id) ?? 0}</td>
                  <td className="px-3 py-2">
                    {o.payment_failed_at ? 'payment failed' : o.stripe_subscription_id ? 'active' : 'no subscription'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <form action={viewAsAction}>
                      <input type="hidden" name="org" value={o.id} />
                      <button type="submit" className="underline hover:text-foreground">
                        View as
                      </button>
                    </form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="max-w-xl space-y-3">
        <h2 className="text-lg font-medium">Credit adjustment</h2>
        <p className="text-sm text-muted-foreground">
          Applies to the current month. Negative minutes = credit (e.g. -100 refunds 100 minutes of
          usage). Every adjustment is recorded with your note.
        </p>
        <AdjustmentForm orgs={(orgs ?? []).map((o) => ({ id: o.id, name: o.name }))} />
        {(adjustments ?? []).length > 0 && (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {(adjustments ?? []).map((a, i) => (
              <li key={i}>
                {new Date(a.created_at).toISOString().slice(0, 10)} ·{' '}
                {(orgs ?? []).find((o) => o.id === a.org_id)?.name ?? a.org_id}:{' '}
                {a.minutes_delta > 0 ? '+' : ''}
                {a.minutes_delta} min — {a.note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
