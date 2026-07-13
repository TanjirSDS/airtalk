// dagre auto-layout for the flow canvas (Phase 18). @xyflow-adjacent, so it lives in
// the fenced flow dir. Top-to-bottom ranks; positions are top-left corners for xyflow.
import type { Edge, Node } from '@xyflow/react'
import dagre from 'dagre'

const NODE_W = 190
const NODE_H = 76

export function layoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 90 })
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  return nodes.map((n) => {
    const p = g.node(n.id)
    return p ? { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } } : n
  })
}
