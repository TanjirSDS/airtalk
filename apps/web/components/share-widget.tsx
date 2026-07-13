'use client'

// Auto-mounting variant of the test widget for the public /share page (no click
// gate). Provider-blind: it only knows the generic descriptor.
import { createElement, useEffect } from 'react'
import type { WidgetEmbed } from './test-widget'

export function ShareWidget({ embed }: { embed: WidgetEmbed }) {
  useEffect(() => {
    if (document.querySelector(`script[src="${embed.scriptSrc}"]`)) return
    const s = document.createElement('script')
    s.src = embed.scriptSrc
    s.async = true
    document.body.appendChild(s)
  }, [embed.scriptSrc])
  return createElement(embed.tagName, embed.attrs)
}
