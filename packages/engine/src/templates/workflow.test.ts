import { describe, expect, it } from 'vitest'
import type { WorkflowGraph } from '../types'
import { defaultWorkflow, validateWorkflow, wrapPromptAsFlow } from './workflow'

describe('defaultWorkflow', () => {
  it('is the Begin → Welcome → End seed and validates clean', () => {
    const g = defaultWorkflow()
    expect(g.startNodeId).toBe('welcome')
    expect(g.nodes.map((n) => n.type)).toEqual(['conversation', 'end'])
    expect(validateWorkflow(g)).toEqual([])
  })
})

describe('wrapPromptAsFlow', () => {
  it('wraps the prompt into the Welcome node and stays valid', () => {
    const g = wrapPromptAsFlow('You are the front desk for Acme Dental.')
    expect(g.nodes[0].prompt).toBe('You are the front desk for Acme Dental.')
    expect(validateWorkflow(g)).toEqual([])
  })
})

describe('validateWorkflow', () => {
  const good: WorkflowGraph = {
    startNodeId: 'welcome',
    nodes: [
      { id: 'welcome', type: 'conversation', label: 'Welcome' },
      { id: 'xfer', type: 'transfer_number', transferTo: '+14155550123' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'welcome', to: 'xfer', condition: 'They want a human.' },
      { from: 'welcome', to: 'end', condition: 'They are done.' },
    ],
  }

  it('accepts a well-formed branching flow', () => {
    expect(validateWorkflow(good)).toEqual([])
  })

  it('rejects an empty graph', () => {
    expect(validateWorkflow(undefined)).toEqual(['The flow has no nodes.'])
    expect(validateWorkflow({ startNodeId: 'x', nodes: [], edges: [] })).toEqual(['The flow has no nodes.'])
  })

  it('flags an orphan / unreachable node', () => {
    const g: WorkflowGraph = {
      startNodeId: 'welcome',
      nodes: [
        { id: 'welcome', type: 'conversation' },
        { id: 'end', type: 'end' },
        { id: 'stray', type: 'conversation' },
      ],
      edges: [{ from: 'welcome', to: 'end', condition: 'done' }],
    }
    expect(validateWorkflow(g).some((e) => e.includes('orphan'))).toBe(true)
  })

  it('flags a conversation dead-end (no outgoing edge)', () => {
    const g: WorkflowGraph = {
      startNodeId: 'welcome',
      nodes: [
        { id: 'welcome', type: 'conversation' },
        { id: 'trap', type: 'conversation' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'welcome', to: 'trap', condition: 'a' },
        { from: 'welcome', to: 'end', condition: 'b' },
      ],
    }
    expect(validateWorkflow(g).some((e) => e.includes('outgoing'))).toBe(true)
  })

  it('requires at least one reachable End node', () => {
    const g: WorkflowGraph = {
      startNodeId: 'welcome',
      nodes: [{ id: 'welcome', type: 'conversation' }, { id: 'x', type: 'transfer_number', transferTo: '+14155550123' }],
      edges: [{ from: 'welcome', to: 'x', condition: 'transfer' }],
    }
    expect(validateWorkflow(g)).toContain('The flow needs an End Call node.')
  })

  it('requires a non-empty condition on every branch of a fork', () => {
    const g: WorkflowGraph = {
      ...good,
      edges: [
        { from: 'welcome', to: 'xfer', condition: '  ' },
        { from: 'welcome', to: 'end', condition: 'done' },
      ],
    }
    expect(validateWorkflow(g).some((e) => e.includes('missing its condition'))).toBe(true)
  })

  it('allows a single unconditional outgoing edge', () => {
    const g: WorkflowGraph = {
      startNodeId: 'welcome',
      nodes: [{ id: 'welcome', type: 'conversation' }, { id: 'end', type: 'end' }],
      edges: [{ from: 'welcome', to: 'end' }],
    }
    expect(validateWorkflow(g)).toEqual([])
  })

  it('rejects a transfer node without a valid E.164 number', () => {
    const g: WorkflowGraph = {
      startNodeId: 'welcome',
      nodes: [
        { id: 'welcome', type: 'conversation' },
        { id: 'xfer', type: 'transfer_number', transferTo: '555-1234' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'welcome', to: 'xfer', condition: 'a' },
        { from: 'welcome', to: 'end', condition: 'b' },
      ],
    }
    expect(validateWorkflow(g).some((e) => e.includes('E.164') || e.includes('+14155550123'))).toBe(true)
  })
})
