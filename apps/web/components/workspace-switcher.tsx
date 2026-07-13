'use client'

import { useActionState, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createWorkspaceAction, switchWorkspaceAction } from '@/app/actions'
import type { Membership } from '../lib/org'
import { cn } from '../lib/utils'
import { Logo } from './icons'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="ml-auto h-4 w-4 text-brand" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5L20 7" />
    </svg>
  )
}

export function WorkspaceSwitcher({
  activeOrgId,
  activeOrgName,
  activePlanName,
  memberships,
  collapsed = false,
}: {
  activeOrgId: string
  activeOrgName: string
  activePlanName: string
  memberships: Membership[]
  collapsed?: boolean
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [pending, startSwitch] = useTransition()
  // Always show the active org even if the membership list is empty
  // (DEV_BYPASS_AUTH / admin view-as have no listed memberships).
  const orgs =
    memberships.length > 0
      ? memberships
      : [{ orgId: activeOrgId, name: activeOrgName, role: '' }]

  function switchTo(orgId: string) {
    if (orgId === activeOrgId) return
    startSwitch(async () => {
      const res = await switchWorkspaceAction(orgId)
      if (res?.error) toast.error(res.error)
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            disabled={pending}
            aria-label="Switch workspace"
            className={cn(
              'flex items-center gap-2.5 rounded-xl text-left transition-colors hover:bg-muted disabled:opacity-60',
              collapsed ? 'w-full justify-center p-0' : 'w-full px-1.5 py-1.5'
            )}
          >
            <Logo />
            {!collapsed && (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-display text-sm font-semibold leading-tight tracking-tight">
                    {activeOrgName}
                  </span>
                  <span className="truncate text-[11px] font-medium capitalize text-muted-foreground">
                    {activePlanName} plan
                  </span>
                </span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
                </svg>
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {orgs.map((m) => (
            <DropdownMenuItem key={m.orgId} onSelect={() => switchTo(m.orgId)}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-soft text-[11px] font-bold text-brand">
                {m.name[0]?.toUpperCase() ?? 'W'}
              </span>
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              {m.orgId === activeOrgId && <Check />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-dashed text-muted-foreground">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [state, formAction, pending] = useActionState(createWorkspaceAction, null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            A new workspace starts on the Starter plan. Set up billing from the Billing page.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <Input name="name" required placeholder="Acme Home Services" maxLength={80} autoFocus />
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Creating…' : 'Create & switch'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
