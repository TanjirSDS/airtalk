'use client'

// Share dialog (Phase 11): toggle a public /share/agent/<token> link on or off.
// ON mints a token + makes the provider agent public; OFF nulls the token so the
// public route 404s. No expiry in v1.
import { useState, useTransition } from 'react'
import { setShareAction } from '../app/agents/actions'
import { CopyIcon } from './icons'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Switch } from './ui/switch'

export function ShareDialog({ agentId, initialToken }: { agentId: string; initialToken: string | null }) {
  const [token, setToken] = useState(initialToken)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  const link = token && typeof window !== 'undefined' ? `${window.location.origin}/share/agent/${token}` : null

  function toggle(on: boolean) {
    setError(null)
    startTransition(async () => {
      const res = await setShareAction(agentId, on)
      if (res.error) setError(res.error)
      else setToken(res.token ?? null)
    })
  }

  function copy() {
    if (!link) return
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this agent</DialogTitle>
          <DialogDescription>
            Anyone with the link can talk to the agent in their browser — no sign-in. Turn it off
            to revoke access.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">Public link</div>
            <div className="text-xs text-muted-foreground">{token ? 'On' : 'Off'}</div>
          </div>
          <Switch checked={!!token} onCheckedChange={toggle} disabled={pending} />
        </div>
        {link && (
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted px-2 py-1.5 text-xs">{link}</code>
            <Button variant="outline" size="sm" onClick={copy}>
              <CopyIcon className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
