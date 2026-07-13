'use client'

import type { AgentType } from '@airtalk/engine/templates'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { convertToFlowAction, createAgentAction, deleteAgentAction, duplicateAgentAction } from '../app/agents/actions'
import { CopyIcon, DownloadIcon, MoreIcon, SearchIcon, UploadIcon } from './icons'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CreateAgentModal } from './create-agent-modal'
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

export interface AgentRow {
  id: string
  name: string
  agentType: AgentType
  voiceName: string | null
  phone: string | null
  updatedBy: string | null
  updatedAt: string | null
  /** Provider-id-free config for Export/Import round-tripping. */
  exportConfig: { agentType: AgentType; template: string | null; agentConfig: unknown }
}

const TYPE_LABEL: Record<AgentType, string> = {
  single: 'Single',
  flow: 'Flow',
  custom_llm: 'Custom LLM',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function AgentsTable({
  agents,
  voices,
  defaultVoiceId,
  openaiEnabled,
  atLimit,
  planName,
  maxAgents,
}: {
  agents: AgentRow[]
  voices: { voiceId: string; name: string }[]
  defaultVoiceId: string
  openaiEnabled: boolean
  atLimit: boolean
  planName: string
  maxAgents: number
}) {
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AgentRow | null>(null)
  const [convertTarget, setConvertTarget] = useState<AgentRow | null>(null)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))

  function exportAgent(a: AgentRow) {
    const blob = new Blob([JSON.stringify(a.exportConfig, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${a.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'agent'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function duplicate(a: AgentRow) {
    startTransition(async () => {
      const res = await duplicateAgentAction(a.id)
      if (res?.error) toast.error(res.error)
      else toast.success(`Duplicated “${a.name}”`)
    })
  }

  function confirmDelete() {
    if (!deleteTarget) return
    const a = deleteTarget
    startTransition(async () => {
      const res = await deleteAgentAction(a.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(`Deleted “${a.name}”`)
        setDeleteTarget(null)
      }
    })
  }

  function confirmConvert() {
    if (!convertTarget) return
    const a = convertTarget
    startTransition(async () => {
      const res = await convertToFlowAction(a.id)
      if (res?.error) toast.error(res.error)
      else {
        toast.success(`Converted “${a.name}” to a flow`)
        setConvertTarget(null)
      }
    })
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    let parsed: { agentType?: AgentType; template?: string | null; agentConfig?: unknown }
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      toast.error('That file is not valid JSON')
      return
    }
    const cfg = parsed.agentConfig as { name?: unknown; systemPrompt?: unknown; voiceId?: unknown } | undefined
    if (!cfg || typeof cfg.name !== 'string' || typeof cfg.systemPrompt !== 'string') {
      toast.error('That JSON is not an exported agent')
      return
    }
    startTransition(async () => {
      const res = await createAgentAction({
        agentType: parsed.agentType ?? 'single',
        template: (parsed.template as never) ?? null,
        agentConfig: parsed.agentConfig as never,
      })
      if (res?.error) toast.error(res.error) // success redirects to the new agent
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[12rem]">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents"
            className="pl-9"
          />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={pending}>
          <UploadIcon className="h-4 w-4" />
          Import
        </Button>
        <CreateAgentModal
          voices={voices}
          defaultVoiceId={defaultVoiceId}
          openaiEnabled={openaiEnabled}
          atLimit={atLimit}
          planName={planName}
          maxAgents={maxAgents}
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Agent Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Voice</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Edited by</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={`/agents/${a.id}`} className="font-medium hover:text-brand">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary">{TYPE_LABEL[a.agentType]}</Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{a.voiceName ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{a.phone ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {a.updatedBy ? (
                    <span>
                      {a.updatedBy} · {timeAgo(a.updatedAt)}
                    </span>
                  ) : (
                    timeAgo(a.updatedAt)
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" aria-label="Agent actions">
                        <MoreIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => duplicate(a)}>
                        <CopyIcon /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportAgent(a)}>
                        <DownloadIcon /> Export
                      </DropdownMenuItem>
                      {a.agentType === 'single' && (
                        <DropdownMenuItem onClick={() => setConvertTarget(a)}>Convert to flow</DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(a)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {agents.length === 0 ? 'No agents yet. Create your first one.' : 'No agents match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete agent</DialogTitle>
            <DialogDescription>
              This deletes “{deleteTarget?.name}” from Airtalk and removes it at the provider. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!convertTarget} onOpenChange={(o) => !o && setConvertTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert to Conversational Flow</DialogTitle>
            <DialogDescription>
              “{convertTarget?.name}” becomes a visual flow: its current prompt moves into a Welcome step of a
              Begin → Welcome → End graph. This is one-way — you can&apos;t convert a flow back to a single prompt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={confirmConvert} disabled={pending}>
              {pending ? 'Converting…' : 'Convert to flow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
