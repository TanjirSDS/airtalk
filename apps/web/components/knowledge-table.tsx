'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createKbDocAction, deleteKbDocAction, setKbAttachmentAction } from '../app/knowledge/actions'
import { MoreIcon, PlusIcon } from './icons'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

export interface KbDocRow {
  id: string
  name: string
  sourceType: string
  createdBy: string | null
  createdAt: string
  usedBy: number
  attachedAgentIds: string[]
}
export interface KbAgent {
  id: string
  name: string
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

export function KnowledgeTable({ docs, agents }: { docs: KbDocRow[]; agents: KbAgent[] }) {
  const [addOpen, setAddOpen] = useState(false)
  const [tab, setTab] = useState<'url' | 'file' | 'text'>('url')
  const [manageTarget, setManageTarget] = useState<KbDocRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<KbDocRow | null>(null)
  const [pending, startTransition] = useTransition()

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    fd.set('sourceType', tab)
    startTransition(async () => {
      const res = await createKbDocAction(fd)
      if (res?.error) toast.error(res.error)
      else {
        toast.success('Knowledge added')
        setAddOpen(false)
        form.reset()
        setTab('url')
      }
    })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    const doc = deleteTarget
    startTransition(async () => {
      const res = await deleteKbDocAction(doc.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(`Deleted “${doc.name}”`)
        setDeleteTarget(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon className="h-4 w-4" />
          Add Knowledge Base
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Used by</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{d.sourceType}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {d.usedBy} agent{d.usedBy === 1 ? '' : 's'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(d.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label="Document actions">
                        <MoreIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setManageTarget(d)}>
                        Manage attachments
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(d)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No documents yet. Add a URL, file, or pasted text your agents can draw on.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add knowledge base</DialogTitle>
            <DialogDescription>
              Add a source your agents can reference. It becomes available to attach to any agent.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kb-name">Name</Label>
              <Input id="kb-name" name="name" placeholder="e.g. Pricing FAQ" required />
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="url">URL</TabsTrigger>
                <TabsTrigger value="file">File</TabsTrigger>
                <TabsTrigger value="text">Text</TabsTrigger>
              </TabsList>
              <TabsContent value="url" className="space-y-1.5">
                <Label htmlFor="kb-url">Page URL</Label>
                <Input id="kb-url" name="url" type="url" placeholder="https://your-site.com/faq" />
              </TabsContent>
              <TabsContent value="file" className="space-y-1.5">
                <Label htmlFor="kb-file">Document</Label>
                <Input id="kb-file" name="file" type="file" accept=".pdf,.txt,.md,.docx,.html" />
              </TabsContent>
              <TabsContent value="text" className="space-y-1.5">
                <Label htmlFor="kb-text">Text</Label>
                <Textarea id="kb-text" name="text" rows={6} placeholder="Paste facts, policies, hours…" />
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Adding…' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage attachments */}
      <ManageDialog
        doc={manageTarget}
        agents={agents}
        onClose={() => setManageTarget(null)}
      />

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              This deletes “{deleteTarget?.name}” and detaches it from every agent that uses it. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Per-doc attachment switches. Local state seeds from the row and stays optimistic;
// each toggle hits the same setKbAttachmentAction the builder rail uses.
function ManageDialog({
  doc,
  agents,
  onClose,
}: {
  doc: KbDocRow | null
  agents: KbAgent[]
  onClose: () => void
}) {
  const [attached, setAttached] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Reseed when a different doc opens.
  if (doc && openedFor !== doc.id) {
    setOpenedFor(doc.id)
    setAttached(new Set(doc.attachedAgentIds))
  }

  function toggle(agentId: string, on: boolean) {
    if (!doc) return
    setAttached((s) => {
      const next = new Set(s)
      if (on) next.add(agentId)
      else next.delete(agentId)
      return next
    })
    startTransition(async () => {
      const res = await setKbAttachmentAction(doc.id, agentId, on)
      if (res?.error) {
        toast.error(res.error)
        setAttached((s) => {
          const next = new Set(s)
          if (on) next.delete(agentId)
          else next.add(agentId)
          return next
        })
      }
    })
  }

  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage attachments</DialogTitle>
          <DialogDescription>
            Choose which agents can use “{doc?.name}”.
          </DialogDescription>
        </DialogHeader>
        {agents.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Create an agent first.</p>
        ) : (
          <ul className="space-y-2">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <span className="flex-1 truncate">{a.name}</span>
                <Switch
                  checked={attached.has(a.id)}
                  disabled={pending}
                  onCheckedChange={(v) => toggle(a.id, v)}
                  aria-label={`Attach to ${a.name}`}
                />
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
