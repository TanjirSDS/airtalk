import type { ReactNode } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { exitViewAsAction } from './admin/actions'
import { graceDaysLeft } from '../lib/billing-math'
import { activeOrg, currentUsage } from '../lib/org'
import { userClient } from '../lib/supabase-server'
import './globals.css'

export const metadata = { title: 'Airtalk' }

async function signOut() {
  'use server'
  const db = await userClient()
  await db.auth.signOut()
  redirect('/login')
}

async function DunningBanner() {
  const org = await activeOrg()
  if (!org?.paymentFailedAt) return null
  const left = graceDaysLeft(new Date(org.paymentFailedAt), new Date())
  const text =
    left > 0
      ? `Payment failed — update your payment method within ${left} day${left === 1 ? '' : 's'} or your agents will be paused.`
      : 'Payment failed — your agents are paused until payment succeeds.'
  return (
    <div className="bg-destructive px-6 py-2 text-center text-sm text-white">
      {text}{' '}
      <Link href="/billing" className="underline">
        Fix payment →
      </Link>
    </div>
  )
}

async function UsageBanner() {
  const org = await activeOrg()
  if (!org) return null
  const usage = await currentUsage(org.orgId)
  if (!usage || usage.minutes_used < usage.minutes_cap * 0.8) return null

  const over = usage.minutes_used >= usage.minutes_cap
  const text = !over
    ? `Heads up: ${Math.round(usage.minutes_used)} of ${usage.minutes_cap} minutes used this month.`
    : org.overagePolicy === 'pause'
      ? 'Minute cap reached — your agents are paused until next month or a plan upgrade.'
      : `Minute cap reached — overage billing active (${Math.round(usage.overage_minutes)} overage minutes so far).`
  return (
    <div
      className={`px-6 py-2 text-center text-sm ${
        over ? 'bg-destructive text-white' : 'bg-amber-100 text-amber-900'
      }`}
    >
      {text}
    </div>
  )
}

const PROVIDER_LABELS: Record<string, string> = {
  db: 'the dashboard database',
  stripe: 'billing (Stripe)',
  elevenlabs: 'the voice service (ElevenLabs)',
  elevenlabs_status: 'the voice service (ElevenLabs)',
  twilio_status: 'the phone network (Twilio)',
}

/** Rows the 5-minute status-poll job marked down within the last hour. */
async function IncidentBanner() {
  const org = await activeOrg()
  if (!org) return null
  const db = await userClient()
  const cutoff = new Date(Date.now() - 3_600_000).toISOString()
  const { data } = await db
    .from('provider_status')
    .select('provider')
    .eq('ok', false)
    .gte('checked_at', cutoff)
  if (!data?.length) return null
  const names = [...new Set(data.map((r) => PROVIDER_LABELS[r.provider] ?? r.provider))]
  return (
    <div className="bg-amber-100 px-6 py-2 text-center text-sm text-amber-900">
      Service disruption affecting {names.join(' and ')} — calls or billing may be delayed while we
      recover.
    </div>
  )
}

async function AdminViewBanner() {
  const jar = await cookies()
  if (!jar.get('admin-view-org')) return null
  const org = await activeOrg()
  if (org?.role !== 'admin') return null
  return (
    <div className="flex items-center justify-center gap-3 bg-violet-700 px-6 py-2 text-center text-sm text-white">
      Admin view: {org.name}
      <form action={exitViewAsAction}>
        <button type="submit" className="underline">
          Exit
        </button>
      </form>
    </div>
  )
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const org = await activeOrg()
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Airtalk
            </Link>
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/calls" className="text-muted-foreground hover:text-foreground">
              Calls
            </Link>
            <Link href="/agents" className="text-muted-foreground hover:text-foreground">
              Agents
            </Link>
            <Link href="/billing" className="text-muted-foreground hover:text-foreground">
              Billing
            </Link>
            {org && (
              <span className="ml-auto flex items-center gap-3 text-muted-foreground">
                {org.name} · {org.plan.name}
                <form action={signOut}>
                  <button type="submit" className="underline hover:text-foreground">
                    Sign out
                  </button>
                </form>
              </span>
            )}
          </nav>
        </header>
        <AdminViewBanner />
        <IncidentBanner />
        <DunningBanner />
        <UsageBanner />
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
