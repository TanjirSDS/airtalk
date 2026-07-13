'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { setKbAttachmentAction } from '../app/knowledge/actions'
import { Badge } from './ui/badge'
import { Switch } from './ui/switch'

export interface AgentKbDoc {
  id: string
  name: string
  sourceType: string
  attached: boolean
}

/** Builder rail KB section (Phase 13): org docs from kb_documents, each a switch
 *  that attaches/detaches this agent. Creation lives on /knowledge. */
export function AgentKbSection({ agentId, docs }: { agentId: string; docs: AgentKbDoc[] }) {
  const [state, setState] = useState(docs)
  const [pending, startTransition] = useTransition()

  function toggle(docId: string, attached: boolean) {
    setState((s) => s.map((d) => (d.id === docId ? { ...d, attached } : d)))
    startTransition(async () => {
      const res = await setKbAttachmentAction(docId, agentId, attached)
      if (res?.error) {
        toast.error(res.error)
        setState((s) => s.map((d) => (d.id === docId ? { ...d, attached: !attached } : d)))
      }
    })
  }

  if (state.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No knowledge base documents yet.{' '}
        <Link href="/knowledge" className="text-brand hover:underline">
          Add one
        </Link>{' '}
        to give this agent facts to draw on.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {state.map((d) => (
          <li key={d.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
            <Badge variant="outline">{d.sourceType}</Badge>
            <span className="flex-1 truncate">{d.name}</span>
            <Switch
              checked={d.attached}
              disabled={pending}
              onCheckedChange={(v) => toggle(d.id, v)}
              aria-label={`Attach ${d.name} to this agent`}
            />
          </li>
        ))}
      </ul>
      <Link href="/knowledge" className="text-xs text-brand hover:underline">
        Manage documents →
      </Link>
    </div>
  )
}
