'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'
import {
  AgentIcon,
  BillingIcon,
  CampaignIcon,
  CloseIcon,
  DashboardIcon,
  LiveDot,
  Logo,
  LogOutIcon,
  MenuIcon,
  PhoneIcon,
  Waveform,
  type IconProps,
} from './icons'

interface ShellOrg {
  name: string
  planName: string
  role: string
}

const NAV: { href: string; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { href: '/calls', label: 'Calls', Icon: PhoneIcon },
  { href: '/agents', label: 'Agents', Icon: AgentIcon },
  { href: '/campaigns', label: 'Campaigns', Icon: CampaignIcon },
  { href: '/billing', label: 'Billing', Icon: BillingIcon },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

export function AppShell({
  org,
  banner,
  signOut,
  children,
}: {
  org: ShellOrg | null
  banner: ReactNode
  signOut: () => void | Promise<void>
  children: ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const current = NAV.find((n) => isActive(pathname, n.href))?.label

  return (
    <div className="flex min-h-screen">
      {/* Mobile backdrop */}
      {open && (
        <button
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/25 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r bg-card transition-transform duration-200 ease-out',
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo />
          <div className="flex min-w-0 flex-col">
            <span className="font-display text-[17px] font-semibold leading-none tracking-tight">
              Airtalk
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Waveform className="text-live" bars={4} />
              line open
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Close menu"
          >
            <CloseIcon className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Workspace
          </p>
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand" />
                )}
                <Icon className={cn('h-5 w-5', active ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground')} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Org / sign out */}
        {org && (
          <div className="border-t p-3">
            <div className="rounded-xl border bg-background px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{org.name}</span>
                <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold capitalize text-brand">
                  {org.planName}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <LiveDot />
                All systems live
              </div>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOutIcon className="h-5 w-5" />
                Sign out
              </button>
            </form>
          </div>
        )}
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md lg:px-8">
          <button
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Airtalk</span>
            {current && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="font-medium text-foreground">{current}</span>
              </>
            )}
          </div>
          {org && (
            <span className="ml-auto hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <LiveDot />
              <span className="capitalize">{org.planName} plan</span>
            </span>
          )}
        </header>

        {banner}

        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
