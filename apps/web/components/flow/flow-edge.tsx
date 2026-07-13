'use client'
// Selectable edge with an inline-editable LLM routing condition label (Phase 18).
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { createContext, useContext, useState } from 'react'

/** The canvas provides the edge-condition setter; the label edits through it. */
export const EdgeConditionContext = createContext<(id: string, condition: string) => void>(() => {})

export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const setCondition = useContext(EdgeConditionContext)
  const d = data as { condition?: string; editable?: boolean } | undefined
  const condition = d?.condition ?? ''
  const editable = d?.editable !== false // the Begin edge sets editable:false
  const [editing, setEditing] = useState(false)

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={selected ? { stroke: 'var(--color-brand)', strokeWidth: 2 } : undefined} />
      {editable && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: labelX, top: labelY, pointerEvents: 'all' }}
          >
            {editing ? (
              <input
                autoFocus
                defaultValue={condition}
                onBlur={(e) => {
                  setCondition(id, e.target.value)
                  setEditing(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditing(false)
                }}
                placeholder="when the caller…"
                className="w-44 rounded border bg-popover px-1.5 py-0.5 text-[11px] shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={
                  'max-w-[180px] truncate rounded border px-1.5 py-0.5 text-[11px] ' +
                  (condition ? 'bg-card' : 'border-dashed bg-card text-muted-foreground')
                }
                title={condition || 'Click to add a routing condition'}
              >
                {condition || '+ condition'}
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
