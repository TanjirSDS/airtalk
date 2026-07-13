'use client'
// Custom flow-canvas node components (Phase 18). Only the node types EL supports for
// our use are here: begin (the synthetic start), conversation, transfer_number, end.
import { Handle, Position, type NodeProps } from '@xyflow/react'

function box(selected: boolean, tone: string) {
  return `rounded-lg border-2 bg-card px-3 py-2 text-xs shadow-sm w-[190px] ${
    selected ? 'border-brand ring-2 ring-brand/30' : tone
  }`
}

export function BeginNode({ selected }: NodeProps) {
  return (
    <div className={box(!!selected, 'border-live/50')}>
      <div className="font-semibold text-live">● Begin</div>
      <div className="truncate text-muted-foreground">Call starts here</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export function ConversationNode({ data, selected }: NodeProps) {
  const d = data as { label?: string; prompt?: string; staticText?: string }
  return (
    <div className={box(!!selected, 'border-border')}>
      <Handle type="target" position={Position.Top} />
      <div className="truncate font-semibold">{d.label || 'Conversation'}</div>
      <div className="line-clamp-2 text-muted-foreground">
        {d.staticText ? `“${d.staticText}”` : d.prompt || 'No instructions yet'}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export function TransferNode({ data, selected }: NodeProps) {
  const d = data as { transferTo?: string }
  return (
    <div className={box(!!selected, 'border-warn/60')}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold">↪ Transfer to number</div>
      <div className="truncate text-muted-foreground">{d.transferTo || 'Set a phone number'}</div>
    </div>
  )
}

export function EndNode({ selected }: NodeProps) {
  return (
    <div className={box(!!selected, 'border-destructive/50')}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-destructive">■ End call</div>
    </div>
  )
}

export const flowNodeTypes = {
  begin: BeginNode,
  conversation: ConversationNode,
  transfer_number: TransferNode,
  end: EndNode,
}
