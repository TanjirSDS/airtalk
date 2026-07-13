'use client'

// Test panel: the provider-blind widget + a "{ }" Test Inputs dialog. Dynamic
// variables are name/value pairs persisted per-agent in localStorage and injected
// into the widget so a live test call can echo them back (acceptance item 3).
import { useEffect, useState } from 'react'
import { TestWidget, type WidgetEmbed } from './test-widget'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { PlusIcon, TrashIcon } from './icons'

type Row = { name: string; value: string }

export function TestPanel({ embed, agentId }: { embed: WidgetEmbed; agentId: string }) {
  const storageKey = `airtalk:test-inputs:${agentId}`
  const [rows, setRows] = useState<Row[]>([])
  const [draft, setDraft] = useState<Row[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setRows(JSON.parse(raw))
    } catch {
      /* ignore malformed storage */
    }
  }, [storageKey])

  const vars = Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value]))

  function save() {
    const cleaned = draft.filter((r) => r.name.trim())
    setRows(cleaned)
    try {
      localStorage.setItem(storageKey, JSON.stringify(cleaned))
    } catch {
      /* storage full / disabled — vars just won't persist */
    }
    setOpen(false)
  }

  return (
    <div className="space-y-3">
      <TestWidget embed={embed} dynamicVars={vars} />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (o) setDraft(rows.length ? rows : [{ name: '', value: '' }])
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <span className="font-mono">{'{ }'}</span> Test inputs
            {Object.keys(vars).length > 0 && (
              <span className="ml-1 text-muted-foreground">({Object.keys(vars).length})</span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test inputs</DialogTitle>
            <DialogDescription>
              Dynamic variables passed into the test call. Reference one in the prompt or first
              message as <code className="font-mono">{'{{name}}'}</code>. Saved in this browser only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {draft.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="name"
                  value={r.name}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="font-mono"
                />
                <Input
                  placeholder="value"
                  value={r.value}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                  aria-label="Remove"
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setDraft([...draft, { name: '', value: '' }])}>
              <PlusIcon className="h-4 w-4" /> Add variable
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
