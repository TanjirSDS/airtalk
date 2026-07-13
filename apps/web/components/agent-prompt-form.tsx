'use client'

import type { Voice } from '@airtalk/engine'
import { useState, useTransition } from 'react'
import { updateAgentAction } from '../app/agents/actions'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Textarea } from './ui/textarea'

/**
 * Freeform-first editor (Phase 10): the prompt text is the source of truth. No
 * template re-render — Save pushes exactly what's typed to the provider and
 * appends a new version row.
 */
export function AgentPromptForm({
  agentId,
  config,
  voices,
}: {
  agentId: string
  config: { name: string; systemPrompt: string; firstMessage: string; voiceId: string }
  voices: Voice[]
}) {
  const [name, setName] = useState(config.name)
  const [firstMessage, setFirstMessage] = useState(config.firstMessage)
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt)
  const [voiceId, setVoiceId] = useState(config.voiceId)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setStatus(null)
    startTransition(async () => {
      const res = await updateAgentAction(agentId, { name, firstMessage, systemPrompt, voiceId })
      setStatus(res.error ? `Error: ${res.error}` : `Saved as version ${res.version}`)
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="agent-name">Agent name</Label>
          <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="voice">Voice</Label>
          <Select id="voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {/* keep the stored voice selectable even if the provider list changes */}
            {!voices.some((v) => v.voiceId === voiceId) && <option value={voiceId}>{voiceId}</option>}
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="first-message">First message</Label>
        <Input
          id="first-message"
          value={firstMessage}
          onChange={(e) => setFirstMessage(e.target.value)}
          placeholder="The exact first line the agent speaks — must disclose it's an AI."
        />
      </div>

      <div>
        <Label htmlFor="system-prompt">System prompt</Label>
        <Textarea
          id="system-prompt"
          rows={18}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          className="font-mono text-xs leading-relaxed"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !name.trim() || !systemPrompt.trim()}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {status && (
          <span
            className={
              status.startsWith('Error') ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
            }
          >
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
