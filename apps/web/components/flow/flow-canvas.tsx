'use client'
// Conversational-flow canvas (Phase 18). @xyflow/react is fenced to this directory
// (eslint). Converts the provider-neutral WorkflowGraph ↔ xyflow nodes/edges: the EL
// `start` node is represented here by a synthetic, non-deletable Begin node whose single
// edge names the entry (startNodeId). Nothing here persists — the builder owns Save.
import '@xyflow/react/dist/style.css'
import {
  addEdge,
  Background,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import type {
  WorkflowEntryBehavior,
  WorkflowGraph,
  WorkflowKb,
  WorkflowNode,
  WorkflowNodeType,
} from '@airtalk/engine/templates'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SettingsRail, type AgentSettings } from '../settings-rail'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Textarea } from '../ui/textarea'
import { EdgeConditionContext, FlowEdge } from './flow-edge'
import { layoutNodes } from './flow-layout'
import { flowNodeTypes } from './flow-nodes'

const BEGIN = '__begin__'
const BEGIN_EDGE = '__begin_edge__'
const edgeTypes = { flow: FlowEdge }

type NodeData = Omit<WorkflowNode, 'id' | 'type' | 'position'>

const ENTRY_LABELS: { value: WorkflowEntryBehavior; label: string }[] = [
  { value: 'generate_immediately', label: 'AI greets first (improvised)' },
  { value: 'auto', label: 'Let the AI decide' },
  { value: 'wait_for_user', label: 'Wait for the caller to speak' },
]

// ---- neutral graph ↔ xyflow ----
function toFlow(g: WorkflowGraph): { nodes: Node[]; edges: Edge[] } {
  const entry = g.nodes.find((n) => n.id === g.startNodeId)
  const beginPos = { x: entry?.position?.x ?? 160, y: (entry?.position?.y ?? 60) - 130 }
  const nodes: Node[] = [
    { id: BEGIN, type: 'begin', position: beginPos, data: {}, deletable: false },
    ...g.nodes.map((n) => {
      const { id, type, position, ...rest } = n
      return { id, type, position: position ?? { x: 160, y: 60 }, data: rest as NodeData }
    }),
  ]
  const edges: Edge[] = [
    { id: BEGIN_EDGE, source: BEGIN, target: g.startNodeId, type: 'flow', data: { editable: false }, deletable: false },
    ...g.edges.map((e, i) => ({
      id: `e_${i}`,
      source: e.from,
      target: e.to,
      type: 'flow',
      data: { condition: e.condition ?? '' },
    })),
  ]
  return { nodes, edges }
}

function fromFlow(nodes: Node[], edges: Edge[]): WorkflowGraph {
  const beginEdge = edges.find((e) => e.source === BEGIN)
  const startNodeId = beginEdge?.target ?? nodes.find((n) => n.id !== BEGIN)?.id ?? ''
  const wnodes = nodes
    .filter((n) => n.id !== BEGIN)
    .map((n) => ({ id: n.id, type: n.type as WorkflowNodeType, position: n.position, ...(n.data as NodeData) }))
  const wedges = edges
    .filter((e) => e.source !== BEGIN)
    .map((e) => {
      const c = (e.data as { condition?: string } | undefined)?.condition?.trim()
      return c ? { from: e.source, to: e.target, condition: c } : { from: e.source, to: e.target }
    })
  return { startNodeId, nodes: wnodes, edges: wedges }
}

function makeNode(type: WorkflowNodeType, position: { x: number; y: number }): Node {
  const id = `n_${crypto.randomUUID().slice(0, 8)}`
  if (type === 'transfer_number') return { id, type, position, data: { label: 'Transfer', transferTo: '' } }
  if (type === 'end') return { id, type, position, data: { label: 'End call' } }
  return { id, type, position, data: { label: 'New step', prompt: '' } }
}

const glyph = (d: string) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3.5 w-3.5"
  >
    <path d={d} />
  </svg>
)
const txt = (s: string) => <span className="text-[10px] font-bold leading-none">{s}</span>

// The full node vocabulary (matches the reference tool). Only the three with a `type`
// are wired into Airtalk's engine today; the rest are shown but marked "Soon" — no fake
// buttons that would produce an unmappable node.
const NODE_ITEMS: { label: string; type?: WorkflowNodeType; icon: ReactNode }[] = [
  { label: 'Conversation', type: 'conversation', icon: glyph('M3 4.8A1.8 1.8 0 014.8 3h6.4A1.8 1.8 0 0113 4.8V8a1.8 1.8 0 01-1.8 1.8H6L3 12z') },
  { label: 'Subagent', icon: glyph('M4.5 6h7v5h-7zM8 3.2V6M6.6 8.4h.01M9.4 8.4h.01') },
  { label: 'Function', icon: txt('ƒ') },
  { label: 'Transfer to number', type: 'transfer_number', icon: glyph('M4.2 3.2l1.4 2.7L4 7.2c.8 1.7 2 3 3.8 3.8l1.3-1.6 2.7 1.4v1.4a1 1 0 01-1 1C6.8 13.2 3 9.4 3 4.6a1 1 0 011-1z') },
  { label: 'Press Digit', icon: txt('01') },
  { label: 'Logic Split', icon: glyph('M4 13V8a3 3 0 013-3h5M10.5 3l2.5 2-2.5 2') },
  { label: 'Agent Transfer', icon: glyph('M3.5 6h9M10 3.5L12.5 6M12.5 10h-9M6 13.5L3.5 11') },
  { label: 'In-Call SMS', icon: glyph('M3 4.8A1.8 1.8 0 014.8 3h6.4A1.8 1.8 0 0113 4.8V8a1.8 1.8 0 01-1.8 1.8H6L3 12zM5.8 6h4.4M5.8 8h2.4') },
  { label: 'Extract Variable', icon: txt('{ }') },
  { label: 'Code', icon: txt('</>') },
  { label: 'MCP', icon: glyph('M8 2.5l4.5 2.6v5.2L8 12.9 3.5 10.3V5.1z') },
  { label: 'End call', type: 'end', icon: glyph('M5 5h6v6H5z') },
  { label: 'Note', icon: glyph('M5 3h6v10H5zM6.8 6h2.4M6.8 8.4h2.4') },
]

export interface FlowCanvasProps {
  graph: WorkflowGraph
  onChange: (g: WorkflowGraph) => void
  globalPrompt: string
  onGlobalPromptChange: (s: string) => void
  settings: AgentSettings
  onSettingsChange: (s: AgentSettings) => void
  /** Org KB docs available for node-level attach (Phase 13 picker, per-node override). */
  kbDocs: WorkflowKb[]
  /** Validation errors from the builder (item 5); shown as a banner. */
  errors: string[]
  /** Agent-level controls (voice/language/model) rendered atop the global settings panel. */
  agentSettings?: ReactNode
  /** For the "Agent details" footer under the node list. */
  agentId: string
  rate: { includedCentsPerMin: number; overageCentsPerMin: number; planName: string }
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function FlowCanvasInner({
  graph,
  onChange,
  globalPrompt,
  onGlobalPromptChange,
  settings,
  onSettingsChange,
  kbDocs,
  errors,
  agentSettings,
  agentId,
  rate,
}: FlowCanvasProps) {
  const initial = useMemo(() => toFlow(graph), [graph])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selNode, setSelNode] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [mode, setMode] = useState<'select' | 'pan'>('pan')
  const [find, setFind] = useState('')
  const [rightTab, setRightTab] = useState<'global' | 'node'>('global')
  const { screenToFlowPosition, setCenter, getNodes } = useReactFlow()

  // Push canvas state up to the builder (dirty/validate/save) without a re-render loop:
  // FlowCanvas owns its state; the parent never feeds `graph` back after mount.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastSent = useRef(JSON.stringify(fromFlow(initial.nodes, initial.edges)))
  useEffect(() => {
    const s = JSON.stringify(fromFlow(nodes, edges))
    if (s !== lastSent.current) {
      lastSent.current = s
      onChangeRef.current(fromFlow(nodes, edges))
    }
  }, [nodes, edges])

  const updateNodeData = (id: string, patch: Partial<NodeData>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
  const setEdgeCondition = (id: string, condition: string) =>
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, condition } } : e)))
  const removeNode = (id: string) => {
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
    setNodes((ns) => ns.filter((n) => n.id !== id))
    setSelNode(null)
  }
  const removeEdge = (id: string) => {
    setEdges((es) => es.filter((e) => e.id !== id))
    setSelEdge(null)
  }

  const selectedNode = nodes.find((n) => n.id === selNode) ?? null
  const selectedEdge = edges.find((e) => e.id === selEdge) ?? null
  const entryId = edges.find((e) => e.source === BEGIN)?.target ?? null
  // Rough token estimate (≈4 chars/token) of the global prompt + every node's instructions.
  const estTokens = useMemo(() => {
    const text =
      globalPrompt +
      nodes.map((n) => `${(n.data as NodeData).prompt ?? ''}${(n.data as NodeData).staticText ?? ''}`).join('')
    return Math.ceil(text.length / 4)
  }, [globalPrompt, nodes])

  return (
    <EdgeConditionContext.Provider value={setEdgeCondition}>
      {errors.length > 0 && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <p className="mb-1 font-semibold">Fix before saving:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 lg:h-[calc(100vh-8rem)] lg:grid-cols-[220px_minmax(0,1fr)_380px]">
        {/* Left: node types + agent details */}
        <aside className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <div className="flex-1 overflow-y-auto p-3">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add a step</p>
            <div className="mt-2 space-y-0.5">
              {NODE_ITEMS.map((n) => {
                const supported = !!n.type
                return (
                  <div
                    key={n.label}
                    draggable={supported}
                    onDragStart={
                      supported ? (e) => e.dataTransfer.setData('application/flow', n.type as string) : undefined
                    }
                    title={supported ? 'Drag onto the canvas' : 'Coming soon'}
                    className={
                      'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ' +
                      (supported
                        ? 'cursor-grab text-foreground hover:bg-accent active:cursor-grabbing'
                        : 'cursor-not-allowed text-muted-foreground/60')
                    }
                  >
                    <span
                      className={
                        'grid h-6 w-6 shrink-0 place-items-center rounded-md border ' +
                        (supported ? 'bg-card text-foreground' : 'bg-muted/40 text-muted-foreground/50')
                      }
                    >
                      {n.icon}
                    </span>
                    <span className="flex-1 truncate">{n.label}</span>
                    {!supported && <span className="text-[10px] font-normal text-muted-foreground/50">Soon</span>}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="shrink-0 border-t p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-muted-foreground">Agent details</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(agentId)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
                title="Copy agent ID"
              >
                Copy ID
              </button>
            </div>
            <dl className="space-y-1">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Cost</dt>
                <dd className="font-medium">${(rate.includedCentsPerMin / 100).toFixed(2)}/min</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Latency</dt>
                <dd className="text-muted-foreground/70">— not measured</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Est. tokens</dt>
                <dd className="font-medium">~{estTokens.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* Center: the canvas (kept roomy) */}
        <div
          className="h-[70vh] rounded-xl border bg-background lg:h-full"
            onDrop={(e) => {
              e.preventDefault()
              const type = e.dataTransfer.getData('application/flow') as WorkflowNodeType
              if (!type) return
              const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
              setNodes((ns) => [...ns, makeNode(type, position)])
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={flowNodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={(c: Connection) =>
                setEdges((es) => addEdge({ ...c, type: 'flow', data: { condition: '' } }, es))
              }
              onReconnect={(oldEdge, c) => setEdges((es) => reconnectEdge(oldEdge, c, es))}
              onSelectionChange={(p: OnSelectionChangeParams) => {
                const n = p.nodes[0]?.id ?? null
                const e = p.edges[0]?.id ?? null
                setSelNode(n)
                setSelEdge(e)
                if (n || e) setRightTab('node')
              }}
              onBeforeDelete={async ({ nodes: dn, edges: de }) => ({
                // Never delete Begin, its edge, or the entry node (would strand the start).
                nodes: dn.filter((n) => n.id !== BEGIN && n.id !== entryId),
                edges: de.filter((e) => e.id !== BEGIN_EDGE),
              })}
              panOnDrag={mode === 'pan'}
              selectionOnDrag={mode === 'select'}
              fitView
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Panel position="bottom-center">
                <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 shadow-pop">
                  <button
                    type="button"
                    onClick={() => setMode('select')}
                    className={'rounded px-2 py-1 text-xs ' + (mode === 'select' ? 'bg-brand-soft text-brand' : 'hover:bg-accent')}
                    title="Box-select"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('pan')}
                    className={'rounded px-2 py-1 text-xs ' + (mode === 'pan' ? 'bg-brand-soft text-brand' : 'hover:bg-accent')}
                    title="Pan"
                  >
                    Pan
                  </button>
                  <span className="h-4 w-px bg-border" />
                  <button
                    type="button"
                    onClick={() => setNodes((ns) => layoutNodes(ns, edges))}
                    className="rounded px-2 py-1 text-xs hover:bg-accent"
                    title="Auto-layout"
                  >
                    Auto-layout
                  </button>
                  <span className="h-4 w-px bg-border" />
                  <input
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      const q = find.trim().toLowerCase()
                      const hit = getNodes().find(
                        (n) => n.id !== BEGIN && String((n.data as NodeData).label ?? n.type).toLowerCase().includes(q)
                      )
                      if (hit) {
                        setCenter(hit.position.x + 95, hit.position.y + 38, { zoom: 1.2, duration: 400 })
                        setSelNode(hit.id)
                      }
                    }}
                    placeholder="Find a step…"
                    className="h-7 w-28 rounded border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </Panel>
            </ReactFlow>
        </div>

        {/* Right: tabbed Global / Node settings. */}
        <aside className="flex flex-col overflow-hidden rounded-xl border bg-card">
          <div className="flex shrink-0 border-b">
            {(['global', 'node'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRightTab(t)}
                className={
                  '-mb-px flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ' +
                  (rightTab === t
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                {t === 'global' ? 'Global Settings' : 'Node Settings'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {rightTab === 'node' ? (
              selectedNode && selectedNode.id !== BEGIN ? (
                <NodeConfig
                  key={selectedNode.id}
                  node={selectedNode}
                  isEntry={selectedNode.id === entryId}
                  kbDocs={kbDocs}
                  onChange={(patch) => updateNodeData(selectedNode.id, patch)}
                  onDelete={() => removeNode(selectedNode.id)}
                />
              ) : selectedNode?.id === BEGIN ? (
                <BeginConfig
                  entryNode={nodes.find((n) => n.id === entryId) ?? null}
                  onEntryBehavior={(b) => entryId && updateNodeData(entryId, { entryBehavior: b })}
                />
              ) : selectedEdge ? (
                <EdgeConfig
                  key={selectedEdge.id}
                  condition={(selectedEdge.data as { condition?: string })?.condition ?? ''}
                  onChange={(c) => setEdgeCondition(selectedEdge.id, c)}
                  onDelete={() => removeEdge(selectedEdge.id)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a step or connection on the canvas to edit its settings.
                </p>
              )
            ) : (
              <GlobalConfig
                agentSettings={agentSettings}
                prompt={globalPrompt}
                onPromptChange={onGlobalPromptChange}
                settings={settings}
                onSettingsChange={onSettingsChange}
              />
            )}
          </div>
        </aside>
      </div>
    </EdgeConditionContext.Provider>
  )
}

// ---- config panels ----
function NodeConfig({
  node,
  isEntry,
  kbDocs,
  onChange,
  onDelete,
}: {
  node: Node
  isEntry: boolean
  kbDocs: WorkflowKb[]
  onChange: (patch: Partial<NodeData>) => void
  onDelete: () => void
}) {
  const d = node.data as NodeData
  const type = node.type as WorkflowNodeType
  const [sayMode, setSayMode] = useState<'prompt' | 'static'>(d.staticText ? 'static' : 'prompt')
  const attachedKb = new Set((d.kb ?? []).map((k) => k.knowledgeId))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold capitalize">{type.replace('_', ' ')} step</h3>
        <button type="button" onClick={onDelete} className="text-xs text-destructive hover:underline">
          Delete
        </button>
      </div>

      <div>
        <Label htmlFor="node-label">Label</Label>
        <Input id="node-label" value={d.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} />
      </div>

      {type === 'conversation' && (
        <>
          <div className="flex gap-2">
            {(['prompt', 'static'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setSayMode(m)
                  // Keep only the active field so the adapter can't see both.
                  if (m === 'prompt') onChange({ staticText: undefined })
                  else onChange({ prompt: undefined })
                }}
                className={
                  'rounded-lg border px-3 py-1.5 text-xs ' +
                  (sayMode === m ? 'border-brand bg-brand-soft text-brand' : 'hover:bg-accent')
                }
              >
                {m === 'prompt' ? 'Prompt (goal)' : 'Static sentence'}
              </button>
            ))}
          </div>
          {sayMode === 'prompt' ? (
            <Textarea
              rows={5}
              value={d.prompt ?? ''}
              onChange={(e) => onChange({ prompt: e.target.value })}
              placeholder="What should the agent do at this step?"
            />
          ) : (
            <Input
              value={d.staticText ?? ''}
              onChange={(e) => onChange({ staticText: e.target.value })}
              placeholder="The exact line to say, then continue."
            />
          )}
          {isEntry && (
            <p className="text-[11px] text-muted-foreground">
              This is the first step. Set who speaks first on the Begin node.
            </p>
          )}
          {kbDocs.length > 0 && (
            <div>
              <Label className="mb-1 block">Knowledge for this step</Label>
              <ul className="space-y-1">
                {kbDocs.map((k) => (
                  <li key={k.knowledgeId} className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={attachedKb.has(k.knowledgeId)}
                      onCheckedChange={(v) => {
                        const kb = (d.kb ?? []).filter((x) => x.knowledgeId !== k.knowledgeId)
                        onChange({ kb: v ? [...kb, k] : kb })
                      }}
                      aria-label={`Attach ${k.name} to this step`}
                    />
                    <span className="flex-1 truncate">{k.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Node-level tools attach through a tool registry — coming soon.
          </p>
        </>
      )}

      {type === 'transfer_number' && (
        <div>
          <Label htmlFor="xfer">Transfer to (E.164)</Label>
          <Input
            id="xfer"
            value={d.transferTo ?? ''}
            onChange={(e) => onChange({ transferTo: e.target.value })}
            placeholder="+14155550123"
          />
        </div>
      )}

      {type === 'end' && <p className="text-xs text-muted-foreground">Ends the call when the flow reaches this step.</p>}
    </div>
  )
}

function BeginConfig({
  entryNode,
  onEntryBehavior,
}: {
  entryNode: Node | null
  onEntryBehavior: (b: WorkflowEntryBehavior) => void
}) {
  const current = (entryNode?.data as NodeData | undefined)?.entryBehavior ?? 'generate_immediately'
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Begin</h3>
      <p className="text-xs text-muted-foreground">The call enters the flow at the first step.</p>
      <Label className="block">Who speaks first</Label>
      {entryNode?.type === 'conversation' ? (
        <div className="flex flex-col gap-2">
          {ENTRY_LABELS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onEntryBehavior(o.value)}
              className={
                'rounded-lg border px-3 py-1.5 text-left text-xs ' +
                (current === o.value ? 'border-brand bg-brand-soft text-brand' : 'hover:bg-accent')
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The first step is not a conversation step, so there is no opening to configure.
        </p>
      )}
    </div>
  )
}

function EdgeConfig({
  condition,
  onChange,
  onDelete,
}: {
  condition: string
  onChange: (c: string) => void
  onDelete: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Connection</h3>
        <button type="button" onClick={onDelete} className="text-xs text-destructive hover:underline">
          Delete
        </button>
      </div>
      <div>
        <Label htmlFor="cond">Routing condition</Label>
        <Textarea
          id="cond"
          rows={3}
          value={condition}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Take this path when… (leave blank only if it's the single next step)"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          When a step has more than one outgoing connection, each needs a condition so the agent can choose.
        </p>
      </div>
    </div>
  )
}

function GlobalConfig({
  agentSettings,
  prompt,
  onPromptChange,
  settings,
  onSettingsChange,
}: {
  agentSettings?: ReactNode
  prompt: string
  onPromptChange: (s: string) => void
  settings: AgentSettings
  onSettingsChange: (s: AgentSettings) => void
}) {
  return (
    <div>
      <Accordion type="multiple" defaultValue={['agent', 'prompt']}>
        <AccordionItem value="agent">
          <AccordionTrigger>Agent Settings</AccordionTrigger>
          <AccordionContent className="space-y-3">{agentSettings}</AccordionContent>
        </AccordionItem>
        <AccordionItem value="prompt">
          <AccordionTrigger>Global Prompt</AccordionTrigger>
          <AccordionContent>
            <Textarea
              id="global-prompt"
              rows={6}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="Persona, business facts, and rules shared by every step."
              className="font-mono text-xs"
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <SettingsRail bare settings={settings} onChange={onSettingsChange} />
    </div>
  )
}
