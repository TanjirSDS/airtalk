// ElevenLabs workflow mapping (Phase 18). EL-specific wire shapes live ONLY here
// and in elevenlabs.ts (rule 1). Pure functions → unit-tested offline (the analog of
// save→GET→match). Verified EL schema is documented in the CLAUDE.md Phase 18 log:
//   workflow = { nodes: Dict<id,node>, edges: Dict<id,edge>, prevent_subagent_loops? }
//   entry = the node whose type === 'start' (there is NO start_node_id field)
//   node types used: start | override_agent (conversation) | phone_number | end
//   edge = { source, target, forward_condition: {type:'llm',condition} | {type:'unconditional'} }
//   every node carries position + edge_order (outgoing edge ids, evaluation order)

import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './types'

const START_ID = 'start'
const START_EDGE_ID = 'edge_start'

/** Deterministic id for the i-th neutral edge, so edge_order can reference it. */
const edgeId = (i: number) => `edge_${i}`

/** A conversation node's static line compiles to a constrained prompt — EL's SDK node
 *  union has no dedicated 'say' node, so we never depend on one (see Phase 18 log). */
function additionalPrompt(n: WorkflowNode): string | undefined {
  if (n.staticText?.trim()) return `Say this line verbatim, then continue: "${n.staticText.trim()}"`
  if (n.prompt?.trim()) return n.prompt
  return undefined
}

/** Neutral → EL top-level `workflow` object. Synthesizes the `start` node + its edge. */
export function workflowToProvider(w: WorkflowGraph): {
  nodes: Record<string, unknown>
  edges: Record<string, unknown>
} {
  const nodes: Record<string, unknown> = {}
  const edges: Record<string, unknown> = {}

  // Neutral edges → EL edges (id-keyed). Remember each node's outgoing edge ids for edge_order.
  const outgoing: Record<string, string[]> = {}
  w.edges.forEach((e, i) => {
    const id = edgeId(i)
    edges[id] = {
      source: e.from,
      target: e.to,
      forward_condition: e.condition?.trim()
        ? { type: 'llm', condition: e.condition.trim() }
        : { type: 'unconditional' },
    }
    ;(outgoing[e.from] ??= []).push(id)
  })

  // Synthetic start node → entry.
  const entry = w.nodes.find((n) => n.id === w.startNodeId)
  edges[START_EDGE_ID] = {
    source: START_ID,
    target: w.startNodeId,
    forward_condition: { type: 'unconditional' },
  }
  nodes[START_ID] = {
    type: 'start',
    position: { x: (entry?.position?.x ?? 160) - 220, y: entry?.position?.y ?? 40 },
    edge_order: [START_EDGE_ID],
  }

  for (const n of w.nodes) {
    const position = n.position ?? { x: 160, y: 40 }
    const edge_order = outgoing[n.id] ?? []
    if (n.type === 'conversation') {
      const ap = additionalPrompt(n)
      nodes[n.id] = {
        type: 'override_agent',
        label: n.label?.trim() || 'Step',
        ...(ap && { additional_prompt: ap }),
        ...(n.toolIds?.length && { additional_tool_ids: n.toolIds }),
        ...(n.kb?.length && {
          additional_knowledge_base: n.kb.map((k) => ({ type: k.type, id: k.knowledgeId, name: k.name })),
        }),
        ...(n.entryBehavior && { entry_behavior: n.entryBehavior }),
        position,
        edge_order,
      }
    } else if (n.type === 'transfer_number') {
      nodes[n.id] = {
        type: 'phone_number',
        transfer_destination: { type: 'phone', phone_number: n.transferTo ?? '' },
        position,
        edge_order,
      }
    } else {
      nodes[n.id] = { type: 'end', position, edge_order: [] }
    }
  }

  return { nodes, edges }
}

/** EL `workflow` (from GET) → neutral graph. Collapses the `start` node back into
 *  startNodeId and drops the synthetic start edge. Returns undefined if there's no graph.
 *  Note: a conversation node's staticText is not recovered (it compiled to additional_prompt),
 *  so it surfaces as `prompt` — the app hydrates from our own stored config, not from here. */
export function workflowFromProvider(raw: unknown): WorkflowGraph | undefined {
  const w = raw as { nodes?: Record<string, any>; edges?: Record<string, any> } | null
  if (!w || typeof w !== 'object' || !w.nodes || typeof w.nodes !== 'object') return undefined

  const startKey = Object.keys(w.nodes).find((id) => w.nodes![id]?.type === 'start')
  const edgeEntries = Object.entries(w.edges ?? {})

  // Entry = target of the start node's outgoing edge (fallback: first non-start node).
  let startNodeId =
    edgeEntries.find(([, e]) => e?.source === startKey)?.[1]?.target ??
    Object.keys(w.nodes).find((id) => id !== startKey) ??
    ''

  const nodes: WorkflowNode[] = []
  for (const [id, n] of Object.entries(w.nodes)) {
    if (n?.type === 'start') continue
    if (n?.type === 'override_agent') {
      nodes.push({
        id,
        type: 'conversation',
        ...(n.label && { label: n.label }),
        ...(n.additional_prompt && { prompt: n.additional_prompt }),
        ...(Array.isArray(n.additional_tool_ids) && n.additional_tool_ids.length && {
          toolIds: n.additional_tool_ids,
        }),
        ...(Array.isArray(n.additional_knowledge_base) && n.additional_knowledge_base.length && {
          kb: n.additional_knowledge_base.map((k: any) => ({ knowledgeId: k.id, name: k.name, type: k.type })),
        }),
        ...(n.entry_behavior && { entryBehavior: n.entry_behavior }),
        ...(n.position && { position: n.position }),
      })
    } else if (n?.type === 'phone_number') {
      nodes.push({
        id,
        type: 'transfer_number',
        ...(n.transfer_destination?.phone_number && { transferTo: n.transfer_destination.phone_number }),
        ...(n.position && { position: n.position }),
      })
    } else if (n?.type === 'end') {
      nodes.push({ id, type: 'end', ...(n.position && { position: n.position }) })
    }
  }

  const edges: WorkflowEdge[] = edgeEntries
    .filter(([, e]) => e?.source !== startKey)
    .map(([, e]) => ({
      from: e.source,
      to: e.target,
      ...(e.forward_condition?.type === 'llm' && e.forward_condition.condition
        ? { condition: e.forward_condition.condition }
        : {}),
    }))

  return { startNodeId, nodes, edges }
}
