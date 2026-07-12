'use client'

// Renders the provider's browser test-call widget from a generic descriptor
// (script + custom element) so this component knows nothing about ElevenLabs.
import { createElement, useEffect, useState } from 'react'
import { Button } from './ui/button'

export function TestWidget({
  embed,
}: {
  embed: { scriptSrc: string; tagName: string; attrs: Record<string, string> }
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || document.querySelector(`script[src="${embed.scriptSrc}"]`)) return
    const s = document.createElement('script')
    s.src = embed.scriptSrc
    s.async = true
    document.body.appendChild(s)
  }, [open, embed.scriptSrc])

  if (!open) {
    return (
      <div className="space-y-2">
        <Button onClick={() => setOpen(true)}>Test your agent</Button>
        <p className="text-xs text-muted-foreground">
          Opens an in-browser voice call. Requires the agent to be public with authentication
          disabled (the default for agents created here).
        </p>
      </div>
    )
  }
  return createElement(embed.tagName, embed.attrs)
}
