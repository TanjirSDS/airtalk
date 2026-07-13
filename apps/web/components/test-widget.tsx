'use client'

// Renders the provider's browser test-call widget from a generic descriptor
// (script + custom element) so this component knows nothing about ElevenLabs.
// dynamicVars are injected via the descriptor-named attribute as a JSON string.
import { createElement, useEffect, useState } from 'react'
import { Button } from './ui/button'

export interface WidgetEmbed {
  scriptSrc: string
  tagName: string
  attrs: Record<string, string>
  dynamicVariablesAttr: string
}

export function TestWidget({
  embed,
  dynamicVars,
}: {
  embed: WidgetEmbed
  dynamicVars?: Record<string, string>
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
  const vars = dynamicVars && Object.keys(dynamicVars).length ? dynamicVars : null
  const attrs = {
    ...embed.attrs,
    ...(vars ? { [embed.dynamicVariablesAttr]: JSON.stringify(vars) } : {}),
    // key on the vars so changing test inputs remounts the widget with them
    key: vars ? JSON.stringify(vars) : 'no-vars',
  }
  return createElement(embed.tagName, attrs)
}
