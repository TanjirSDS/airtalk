'use client'

// Versions panel (Phase 11, item 4): list versions with inline-editable labels,
// restore (append-only rollback), and a simple prompt line-diff of a selected
// version against the current one.
import { useState, useTransition } from 'react'
import { renameVersionAction, rollbackAgentAction } from '../app/agents/actions'
import { lineDiff } from '../lib/line-diff'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet'
import { cn } from '../lib/utils'

export interface VersionRow {
  version: number
  createdAt: string
  label: string | null
  prompt: string
}

export function VersionsSheet({ agentId, versions }: { agentId: string; versions: VersionRow[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const current = versions[0]
  const sel = versions.find((v) => v.version === selected)

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Versions
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            Every save is a version. Restoring re-applies it to the provider and records it as a new
            version.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-2">
            {versions.map((v, i) => (
              <li key={v.version} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={i === 0 ? 'default' : 'outline'}>v{v.version}</Badge>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                    {i === 0 && ' · current'}
                  </span>
                  {i !== 0 && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(selected === v.version ? null : v.version)}
                      >
                        {selected === v.version ? 'Hide diff' : 'Diff'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            await rollbackAgentAction(agentId, v.version)
                          })
                        }
                      >
                        Restore
                      </Button>
                    </>
                  )}
                </div>
                <Input
                  defaultValue={v.label ?? ''}
                  placeholder="Add a label…"
                  className="mt-2 h-8 text-xs"
                  onBlur={(e) => {
                    if (e.target.value.trim() === (v.label ?? '')) return
                    startTransition(async () => {
                      await renameVersionAction(agentId, v.version, e.target.value)
                    })
                  }}
                />
              </li>
            ))}
          </ul>

          {sel && current && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                Prompt diff: v{sel.version} → current (v{current.version})
              </div>
              <pre className="overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-relaxed">
                {lineDiff(sel.prompt, current.prompt).map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      'whitespace-pre-wrap',
                      l.type === 'add' && 'bg-live-soft text-live',
                      l.type === 'del' && 'bg-destructive/10 text-destructive line-through'
                    )}
                  >
                    {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                    {l.text || ' '}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
