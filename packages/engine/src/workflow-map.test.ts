import { describe, expect, it } from 'vitest'
import type { WorkflowGraph } from './types'
import { workflowFromProvider, workflowToProvider } from './workflow-map'

const graph: WorkflowGraph = {
  startNodeId: 'welcome',
  nodes: [
    {
      id: 'welcome',
      type: 'conversation',
      label: 'Welcome',
      prompt: 'Greet the caller and find out what they need.',
      entryBehavior: 'generate_immediately',
      toolIds: ['tool_1'],
      kb: [{ knowledgeId: 'kb_1', name: 'FAQ', type: 'text' }],
      position: { x: 100, y: 40 },
    },
    { id: 'sales', type: 'transfer_number', transferTo: '+14155550123', position: { x: 40, y: 260 } },
    { id: 'end', type: 'end', position: { x: 260, y: 260 } },
  ],
  edges: [
    { from: 'welcome', to: 'sales', condition: 'The caller wants to buy something.' },
    { from: 'welcome', to: 'end', condition: 'The caller is done.' },
  ],
}

describe('workflowToProvider', () => {
  const { nodes, edges } = workflowToProvider(graph)

  it('synthesizes a start node and its unconditional edge to the entry', () => {
    expect((nodes.start as any).type).toBe('start')
    const startEdge = Object.values(edges).find((e: any) => e.source === 'start') as any
    expect(startEdge.target).toBe('welcome')
    expect(startEdge.forward_condition.type).toBe('unconditional')
    expect((nodes.start as any).edge_order).toHaveLength(1)
  })

  it('maps node types to the verified EL type strings', () => {
    expect((nodes.welcome as any).type).toBe('override_agent')
    expect((nodes.sales as any).type).toBe('phone_number')
    expect((nodes.end as any).type).toBe('end')
  })

  it('maps conversation overrides + transfer destination', () => {
    const w = nodes.welcome as any
    expect(w.additional_prompt).toContain('Greet the caller')
    expect(w.additional_tool_ids).toEqual(['tool_1'])
    expect(w.additional_knowledge_base).toEqual([{ type: 'text', id: 'kb_1', name: 'FAQ' }])
    expect(w.entry_behavior).toBe('generate_immediately')
    expect((nodes.sales as any).transfer_destination).toEqual({ type: 'phone', phone_number: '+14155550123' })
  })

  it('maps LLM conditions and records edge_order per source', () => {
    const llmEdges = Object.values(edges).filter((e: any) => e.forward_condition.type === 'llm')
    expect(llmEdges).toHaveLength(2)
    expect((nodes.welcome as any).edge_order).toHaveLength(2)
  })

  it('static text compiles to a constrained prompt (no dependency on a say node)', () => {
    const { nodes: n2 } = workflowToProvider({
      startNodeId: 'a',
      nodes: [
        { id: 'a', type: 'conversation', staticText: 'Thanks for calling Acme.' },
        { id: 'z', type: 'end' },
      ],
      edges: [{ from: 'a', to: 'z', condition: 'done' }],
    })
    expect((n2.a as any).additional_prompt).toBe('Say this line verbatim, then continue: "Thanks for calling Acme."')
  })
})

describe('round-trip neutral → provider → neutral', () => {
  const back = workflowFromProvider(workflowToProvider(graph))!

  it('recovers the entry node', () => {
    expect(back.startNodeId).toBe('welcome')
  })

  it('recovers every non-start node with its fields', () => {
    expect(back.nodes.map((n) => n.id).sort()).toEqual(['end', 'sales', 'welcome'])
    const w = back.nodes.find((n) => n.id === 'welcome')!
    expect(w.type).toBe('conversation')
    expect(w.prompt).toContain('Greet the caller')
    expect(w.entryBehavior).toBe('generate_immediately')
    expect(w.toolIds).toEqual(['tool_1'])
    expect(w.kb).toEqual([{ knowledgeId: 'kb_1', name: 'FAQ', type: 'text' }])
    expect(w.position).toEqual({ x: 100, y: 40 })
    expect(back.nodes.find((n) => n.id === 'sales')!.transferTo).toBe('+14155550123')
  })

  it('recovers edges as {from,to,condition} and drops the synthetic start edge', () => {
    expect(back.edges).toEqual([
      { from: 'welcome', to: 'sales', condition: 'The caller wants to buy something.' },
      { from: 'welcome', to: 'end', condition: 'The caller is done.' },
    ])
  })
})

describe('workflowFromProvider', () => {
  it('returns undefined for a missing / malformed workflow', () => {
    expect(workflowFromProvider(undefined)).toBeUndefined()
    expect(workflowFromProvider(null)).toBeUndefined()
    expect(workflowFromProvider({})).toBeUndefined()
  })
})
