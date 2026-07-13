'use client'

// Custom LLM editor (Phase 11, item 8): for agent_type 'custom_llm', this replaces
// the prompt editor. The API key is sent to the server action, stored as an
// ElevenLabs workspace secret, and only the secret id is persisted — the key
// never lands in our DB.
import { useState, useTransition } from 'react'
import { updateCustomLlmAction } from '../app/agents/actions'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

export function CustomLlmForm({
  agentId,
  initial,
}: {
  agentId: string
  initial: { url: string; modelId: string; hasKey: boolean }
}) {
  const [url, setUrl] = useState(initial.url)
  const [modelId, setModelId] = useState(initial.modelId)
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setStatus(null)
    startTransition(async () => {
      const res = await updateCustomLlmAction(agentId, { url, modelId, apiKey })
      if (res.error) setStatus(`Error: ${res.error}`)
      else {
        setStatus(`Saved as version ${res.version}`)
        setApiKey('')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="cl-url">Endpoint URL</Label>
        <Input
          id="cl-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-host.com/v1"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Your OpenAI-compatible chat-completions endpoint.
        </p>
      </div>
      <div>
        <Label htmlFor="cl-model">Model ID (optional)</Label>
        <Input id="cl-model" value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="my-model" />
      </div>
      <div>
        <Label htmlFor="cl-key">API key</Label>
        <Input
          id="cl-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={initial.hasKey ? '•••••••• (stored — leave blank to keep)' : 'sk-…'}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Stored as a secret at the provider — never saved in Airtalk.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !url.trim()}>
          {pending ? 'Saving…' : 'Save connection'}
        </Button>
        {status && (
          <span className={status.startsWith('Error') ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
