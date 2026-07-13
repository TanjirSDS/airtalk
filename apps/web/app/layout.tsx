import type { ReactNode } from 'react'
import { Manrope, Space_Grotesk } from 'next/font/google'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppShell } from '../components/app-shell'
import { Logo, Waveform } from '../components/icons'
import { ThemeProvider } from '../components/theme-provider'
import { Toaster } from '../components/ui/sonner'
import { exitViewAsAction } from './admin/actions'
import { graceDaysLeft } from '../lib/billing-math'
import { activeOrg, currentUsage, listMemberships } from '../lib/org'
import { userClient } from '../lib/supabase-server'
import './globals.css'

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space',
  weight: ['500', '600', '700'],
  display: 'swap',
})
const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata = { title: 'Airtalk', description: 'AI voice agents for small business' }

async function signOut() {
  'use server'
  const db = await userClient()
  await db.auth.signOut()
  redirect('/login')
}

// One shared strip style for every top-of-app alert.
function Banner({
  tone,
  children,
}: {
  tone: 'danger' | 'warn' | 'brand'
  children: ReactNode
}) {
  const tones = {
    danger: 'bg-danger-soft text-destructive',
    warn: 'bg-warn-soft text-warn',
    brand: 'bg-brand-soft text-brand',
  }
  return (
    <div className={`flex items-center justify-center gap-2 px-6 py-2 text-center text-sm font-medium ${tones[tone]}`}>
      {children}
    </div>
  )
}

async function DunningBanner() {
  const org = await activeOrg()
  if (!org?.paymentFailedAt) return null
  const left = graceDaysLeft(new Date(org.paymentFailedAt), new Date())
  return (
    <Banner tone="danger">
      {left > 0
        ? `Payment failed — update your payment method within ${left} day${left === 1 ? '' : 's'} or your agents will be paused.`
        : 'Payment failed — your agents are paused until payment succeeds.'}
      <Link href="/billing" className="underline underline-offset-2">
        Fix payment →
      </Link>
    </Banner>
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
  return <Banner tone={over ? 'danger' : 'warn'}>{text}</Banner>
}

const PROVIDER_LABELS: Record<string, string> = {
  db: 'the dashboard database',
  stripe: 'billing (Stripe)',
  elevenlabs: 'the voice service (ElevenLabs)',
  elevenlabs_status: 'the voice service (ElevenLabs)',
  twilio_status: 'the phone network (Twilio)',
}

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
    <Banner tone="warn">
      Service disruption affecting {names.join(' and ')} — calls or billing may be delayed while we
      recover.
    </Banner>
  )
}

async function AdminViewBanner() {
  const jar = await cookies()
  if (!jar.get('admin-view-org')) return null
  const org = await activeOrg()
  if (org?.role !== 'admin') return null
  return (
    <div className="flex items-center justify-center gap-3 bg-foreground px-6 py-2 text-center text-sm font-medium text-background">
      Admin view: {org.name}
      <form action={exitViewAsAction}>
        <button type="submit" className="underline underline-offset-2">
          Exit
        </button>
      </form>
    </div>
  )
}

function Banners() {
  return (
    <>
      <AdminViewBanner />
      <IncidentBanner />
      <DunningBanner />
      <UsageBanner />
    </>
  )
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const org = await activeOrg()

  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable}`}>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {org ? (
            <AppShell data={await shellData(org)} banner={<Banners />} signOut={signOut}>
              {children}
            </AppShell>
          ) : (
            // Signed-out (login / signup): a clean centered brand canvas.
            <div className="flex min-h-screen flex-col">
              <div className="flex items-center gap-3 px-6 py-5">
                <Logo />
                <span className="font-display text-lg font-semibold tracking-tight">Airtalk</span>
                <Waveform className="ml-1 text-live" bars={4} />
              </div>
              <main className="flex flex-1 items-center justify-center px-6 pb-24">
                <div className="w-full">{children}</div>
              </main>
            </div>
          )}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}

// Assemble everything the sidebar shell needs in one place.
async function shellData(org: NonNullable<Awaited<ReturnType<typeof activeOrg>>>) {
  const [usage, memberships, jar, db] = await Promise.all([
    currentUsage(org.orgId),
    listMemberships(),
    cookies(),
    userClient(),
  ])
  const {
    data: { user },
  } = await db.auth.getUser()
  const now = new Date()
  return {
    activeOrgId: org.orgId,
    orgName: org.name,
    planName: org.plan.name,
    role: org.role,
    memberships,
    userEmail: user?.email ?? null,
    initialCollapsed: jar.get('sidebar-collapsed')?.value === '1',
    usage: {
      minutesUsed: usage?.minutes_used ?? 0,
      minutesCap: usage?.minutes_cap ?? org.minutesCap,
      overageMinutes: usage?.overage_minutes ?? 0,
      overagePolicy: org.overagePolicy,
      planName: org.plan.name,
      periodLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    },
  }
}
