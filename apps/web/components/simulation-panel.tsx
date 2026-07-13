'use client'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { deleteTestCaseAction, runSimulationAction, saveTestCaseAction } from '../app/agents/actions'
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
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Textarea } from './ui/textarea'

export interface SimTestCase {
  id: string
  name: string
  user_prompt: string
  success_criteria: string
  last_result: {
    passed: boolean | null
    transcript: { role: string; message: string }[]
    summary?: string
    criteria?: { name: string; result: string; rationale?: string }[]
    ranAt: string
  } | null
  updated_at: string
}

function ResultBadge({ passed }: { passed: boolean | null }) {
  if (passed === true) return <Badge variant="live">Passed</Badge>
  if (passed === false) return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

export function SimulationPanel({
  agentId,
  canRun,
  testCases,
  startNodes = [],
}: {
  agentId: string
  canRun: boolean
  testCases: SimTestCase[]
  /** Flow agents (Phase 18): the nodes the sim can start at (Test-panel Starting Node picker). */
  startNodes?: { id: string; label: string }[]
}) {
  const [editing, setEditing] = useState<SimTestCase | null>(null)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<SimTestCase | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [startAt, setStartAt] = useState('')
  const [pending, startTransition] = useTransition()

  function run(id: string) {
    setRunningId(id)
    startTransition(async () => {
      const res = await runSimulationAction(agentId, id, startAt || undefined)
      setRunningId(null)
      if (res.error) toast.error(res.error)
      else if (res.result?.passed === true) toast.success('Simulation passed')
      else if (res.result?.passed === false) toast.error('Simulation failed')
      else toast('Simulation ran (no verdict)')
    })
  }

  function remove(tc: SimTestCase) {
    if (!confirm(`Delete test case "${tc.name}"?`)) return
    startTransition(async () => {
      const res = await deleteTestCaseAction(agentId, tc.id)
      if (res.error) toast.error(res.error)
      else toast.success('Test case deleted')
    })
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Simulation</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Run a scripted user against this agent and grade the result — no real call placed.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          + Test Case
        </Button>
      </div>

      {!canRun && (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          Save this agent first — simulation needs a provider agent to run against.
        </p>
      )}

      {startNodes.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="start-at" className="text-xs">
            Start at
          </Label>
          <Select
            id="start-at"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="h-8 w-auto text-xs"
          >
            <option value="">Begin (default entry)</option>
            {startNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </Select>
          <span className="text-[11px] text-muted-foreground">
            Starting mid-flow uses the provider’s starting-node override (verify on a live run).
          </span>
        </div>
      )}

      {testCases.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No test cases yet. Add one to check how your agent handles a scripted caller.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Test case</th>
                <th className="px-3 py-2 font-medium">Last result</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {testCases.map((tc) => (
                <tr key={tc.id} className="border-b last:border-0 align-middle">
                  <td className="px-3 py-2">
                    <div className="font-medium">{tc.name}</div>
                    <div className="line-clamp-1 max-w-xs text-xs text-muted-foreground">{tc.user_prompt}</div>
                  </td>
                  <td className="px-3 py-2">
                    {tc.last_result ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2"
                        onClick={() => setViewing(tc)}
                        title="View transcript"
                      >
                        <ResultBadge passed={tc.last_result.passed} />
                        <span className="text-xs text-muted-foreground underline">view</span>
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not run</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={!canRun || pending} onClick={() => run(tc.id)}>
                        {runningId === tc.id ? 'Running…' : 'Run'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(tc)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(tc)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <TestCaseDialog
          agentId={agentId}
          testCase={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}

      {viewing?.last_result && (
        <ResultDialog testCase={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function TestCaseDialog({
  agentId,
  testCase,
  onClose,
}: {
  agentId: string
  testCase: SimTestCase | null
  onClose: () => void
}) {
  const [name, setName] = useState(testCase?.name ?? '')
  const [userPrompt, setUserPrompt] = useState(testCase?.user_prompt ?? '')
  const [successCriteria, setSuccessCriteria] = useState(testCase?.success_criteria ?? '')
  const [pending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      const res = await saveTestCaseAction(agentId, {
        id: testCase?.id,
        name,
        userPrompt,
        successCriteria,
      })
      if (res.error) toast.error(res.error)
      else {
        toast.success(testCase ? 'Test case updated' : 'Test case added')
        onClose()
      }
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{testCase ? 'Edit test case' : 'New test case'}</DialogTitle>
          <DialogDescription>
            Describe the caller and what a good outcome looks like. The simulated user follows your script.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Angry customer wants a refund" />
          </div>
          <div className="space-y-1.5">
            <Label>Simulated user</Label>
            <Textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={4}
              placeholder="You are a caller whose water heater is leaking. You want an appointment today and get impatient if put on hold."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Success criteria</Label>
            <Textarea
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              rows={3}
              placeholder="The agent booked an appointment or captured the caller's name and number for a callback."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim() || !userPrompt.trim()}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResultDialog({ testCase, onClose }: { testCase: SimTestCase; onClose: () => void }) {
  const r = testCase.last_result!
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {testCase.name} <ResultBadge passed={r.passed} />
          </DialogTitle>
          <DialogDescription>Ran {new Date(r.ranAt).toLocaleString()}</DialogDescription>
        </DialogHeader>
        {r.summary && <p className="text-sm text-muted-foreground">{r.summary}</p>}
        {r.criteria && r.criteria.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {r.criteria.map((c, i) => (
              <Badge key={i} variant={c.result.toLowerCase() === 'success' ? 'live' : 'destructive'} className="normal-case">
                {c.name.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}
        <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3 text-sm">
          {r.transcript.length === 0 ? (
            <p className="text-muted-foreground">No transcript returned.</p>
          ) : (
            r.transcript.map((t, i) => (
              <div key={i}>
                <span className="mr-2 font-medium capitalize text-muted-foreground">{t.role}:</span>
                <span>{t.message}</span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
