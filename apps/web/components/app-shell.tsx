'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'
import type { Membership } from '../lib/org'
import { AccountMenu } from './account-menu'
import {
  AgentIcon,
  BillingIcon,
  BookIcon,
  CampaignIcon,
  ChartIcon,
  DashboardIcon,
  HashIcon,
  MenuIcon,
  PhoneIcon,
  UsersIcon,
  Waveform,
  type IconProps,
} from './icons'
import { Sheet, SheetContent, SheetTitle } from './ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { UsageWidget, type UsageData } from './usage-widget'
import { WorkspaceSwitcher } from './workspace-switcher'

// Cookie name also read (SSR) in app/layout.tsx to seed `initialCollapsed`.
const SIDEBAR_COOKIE = 'sidebar-collapsed'

// One structured array; later phases insert items in canonical order and add
// the icon in components/icons.tsx. Only routes that exist today are listed.
// Full intended order: Dashboard, Agents, Knowledge Base, Phone Numbers,
// Call History, Contacts, Campaigns, Analytics, QA, Alerting, Integrations, Billing.
const NAV: { href: string; label: string; Icon: (p: IconProps) => ReactNode }[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { href: '/agents', label: 'Agents', Icon: AgentIcon },
  { href: '/knowledge', label: 'Knowledge Base', Icon: BookIcon },
  { href: '/numbers', label: 'Phone Numbers', Icon: HashIcon },
  { href: '/calls', label: 'Call History', Icon: PhoneIcon },
  { href: '/contacts', label: 'Contacts', Icon: UsersIcon },
  { href: '/campaigns', label: 'Campaigns', Icon: CampaignIcon },
  { href: '/analytics', label: 'Analytics', Icon: ChartIcon },
  { href: '/billing', label: 'Billing', Icon: BillingIcon },
]

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/')
}

export interface ShellData {
  activeOrgId: string
  orgName: string
  planName: string
  role: string
  usage: UsageData
  memberships: Membership[]
  userEmail: string | null
  initialCollapsed: boolean
}

function PanelToggleIcon(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn('h-5 w-5', p.className)} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  )
}

// Sidebar body shared by the desktop rail and the mobile slide-over. Module
// scope (not nested in AppShell) so it keeps a stable identity — toggling
// collapse or the mobile sheet won't remount the switcher/menus.
function SidebarBody({
  data,
  signOut,
  pathname,
  rail,
  onNavigate,
}: {
  data: ShellData
  signOut: () => void | Promise<void>
  pathname: string
  rail: boolean
  onNavigate?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex items-center border-b', rail ? 'justify-center p-3' : 'px-3 py-3')}>
        <WorkspaceSwitcher
          activeOrgId={data.activeOrgId}
          activeOrgName={data.orgName}
          activePlanName={data.planName}
          memberships={data.memberships}
          collapsed={rail}
        />
      </div>

      <nav className={cn('flex flex-1 flex-col gap-1 overflow-y-auto py-3', rail ? 'px-2' : 'px-3')}>
        {!rail && (
          <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Workspace
          </p>
        )}
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href)
          const link = (
            <Link
              href={href}
              onClick={onNavigate}
              aria-label={label}
              className={cn(
                'group relative flex items-center rounded-lg text-sm font-medium transition-colors',
                rail ? 'mx-auto h-10 w-10 justify-center' : 'gap-3 px-3 py-2',
                active
                  ? 'bg-brand-soft text-brand'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand" />
              )}
              <Icon
                className={cn(
                  'h-5 w-5',
                  active ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              {!rail && label}
            </Link>
          )
          return rail ? (
            <Tooltip key={href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={href}>{link}</div>
          )
        })}
      </nav>

      <div className={cn('mt-auto flex flex-col gap-2 border-t p-3', rail && 'items-center')}>
        <UsageWidget data={data.usage} collapsed={rail} />
        <AccountMenu email={data.userEmail} signOut={signOut} collapsed={rail} />
      </div>
    </div>
  )
}

export function AppShell({
  data,
  banner,
  signOut,
  children,
}: {
  data: ShellData
  banner: ReactNode
  signOut: () => void | Promise<void>
  children: ReactNode
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(data.initialCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const current = NAV.find((n) => isActive(pathname, n.href))?.label

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c
      document.cookie = `${SIDEBAR_COOKIE}=${next ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex min-h-screen">
        {/* Desktop sidebar — collapsible icon rail */}
        <aside
          className={cn(
            'hidden border-r bg-card transition-[width] duration-200 ease-out lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col',
            collapsed ? 'lg:w-[72px]' : 'lg:w-[264px]'
          )}
        >
          <SidebarBody data={data} signOut={signOut} pathname={pathname} rail={collapsed} />
        </aside>

        {/* Mobile slide-over */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[280px] p-0" showClose={false}>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarBody
              data={data}
              signOut={signOut}
              pathname={pathname}
              rail={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md lg:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
              aria-label="Open menu"
            >
              <MenuIcon />
            </button>
            <button
              onClick={toggleCollapse}
              className="hidden h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:grid"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
            >
              <PanelToggleIcon />
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
            <span className="ml-auto hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:flex">
              <Waveform className="text-live" bars={4} />
              line open
            </span>
          </header>

          {banner}

          <main className="flex-1">
            <div className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">{children}</div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
