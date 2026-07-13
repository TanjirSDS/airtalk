// Browser-safe conversational-flow helpers (Phase 18): the default seed graph, the
// single→flow wrap, and validation shared verbatim by the canvas (client), the create
// modal, the convert action, and the server save action. Pure (no provider/DB) — see
// shared.ts for the browser-safe guarantee. Deterministic (no random/Date) so it's testable.

import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../types'

export const WELCOME_NODE_ID = 'welcome'
export const END_NODE_ID = 'end'

/** E.164: '+' then 7–15 digits, first digit non-zero. */
export const E164 = /^\+[1-9]\d{6,14}$/

/**
 * Default seed graph — Begin → Welcome (conversation) → End Call, matching the handoff.
 * The Welcome node improvises its opening (entry_behavior generate_immediately) and
 * transitions to End when the caller is done. Begin is not a node here — it's `startNodeId`.
 */
export function defaultWorkflow(): WorkflowGraph {
  return {
    startNodeId: WELCOME_NODE_ID,
    nodes: [
      {
        id: WELCOME_NODE_ID,
        type: 'conversation',
        label: 'Welcome',
        prompt: 'Greet the caller, find out why they are calling, and help them.',
        entryBehavior: 'generate_immediately',
        position: { x: 160, y: 40 },
      },
      { id: END_NODE_ID, type: 'end', label: 'End call', position: { x: 160, y: 280 } },
    ],
    edges: [
      { from: WELCOME_NODE_ID, to: END_NODE_ID, condition: "The caller's request is fully handled and they have nothing else." },
    ],
  }
}

/** Convert single→flow: wrap an existing system prompt into the Welcome node of a fresh
 *  default graph (one-way; the prompt becomes the entry conversation node's goal). */
export function wrapPromptAsFlow(systemPrompt: string): WorkflowGraph {
  const g = defaultWorkflow()
  g.nodes[0] = { ...g.nodes[0], prompt: systemPrompt.trim() || g.nodes[0].prompt }
  return g
}

const nodeLabel = (n: WorkflowNode) => n.label?.trim() || n.type.replace('_', ' ')

/**
 * Validate a flow before save (client AND server run this — item 5). Returns human-readable
 * errors; empty array = valid. Rules: exactly one start path (one entry, every other node has
 * an incoming edge), no orphan/unreachable nodes, conversation nodes aren't dead-ends and an
 * End is reachable, branch edges carry a non-empty condition, transfer nodes have a valid E.164.
 */
export function validateWorkflow(w: WorkflowGraph | undefined): string[] {
  const errs: string[] = []
  if (!w || !Array.isArray(w.nodes) || !w.nodes.length) return ['The flow has no nodes.']
  const edges: WorkflowEdge[] = Array.isArray(w.edges) ? w.edges : []

  const ids = new Set<string>()
  for (const n of w.nodes) {
    if (ids.has(n.id)) errs.push(`Duplicate node "${nodeLabel(n)}".`)
    ids.add(n.id)
  }
  if (!ids.has(w.startNodeId)) errs.push('The Begin node points to a step that no longer exists.')
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) errs.push('A connection points to a step that no longer exists.')
  }

  const outgoing = new Map<string, WorkflowEdge[]>()
  const incoming = new Map<string, number>()
  for (const e of edges) {
    const list = outgoing.get(e.from) ?? []
    list.push(e)
    outgoing.set(e.from, list)
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  }

  // Reachability from the single start path.
  const reachable = new Set<string>()
  const stack = [w.startNodeId]
  while (stack.length) {
    const id = stack.pop()!
    if (reachable.has(id) || !ids.has(id)) continue
    reachable.add(id)
    for (const e of outgoing.get(id) ?? []) stack.push(e.to)
  }

  for (const n of w.nodes) {
    if (n.id !== w.startNodeId) {
      if (!incoming.get(n.id)) errs.push(`"${nodeLabel(n)}" has no incoming connection (orphan step).`)
      else if (!reachable.has(n.id)) errs.push(`"${nodeLabel(n)}" can't be reached from the Begin node.`)
    }
    const outs = outgoing.get(n.id) ?? []
    if (n.type === 'conversation' && !outs.length) {
      errs.push(`"${nodeLabel(n)}" needs at least one outgoing connection.`)
    }
    if (n.type === 'transfer_number' && !E164.test((n.transferTo ?? '').trim())) {
      errs.push(`"${nodeLabel(n)}" needs a valid phone number, e.g. +14155550123.`)
    }
    if (outs.length > 1) {
      for (const e of outs) {
        if (!e.condition?.trim()) errs.push(`A branch out of "${nodeLabel(n)}" is missing its condition.`)
      }
    }
  }

  const ends = w.nodes.filter((n) => n.type === 'end')
  if (!ends.length) errs.push('The flow needs an End Call node.')
  else if (!ends.some((n) => reachable.has(n.id))) errs.push('No End Call node can be reached from the Begin node.')

  return [...new Set(errs)]
}
