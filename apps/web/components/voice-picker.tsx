'use client'

import type { Voice } from '@airtalk/engine'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

export function VoicePicker({
  voices,
  value,
  onChange,
}: {
  voices: Voice[]
  value: string
  onChange: (voiceId: string) => void
}) {
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
      {voices.map((v) => (
        <label
          key={v.voiceId}
          className={cn(
            'flex cursor-pointer items-center gap-3 rounded-md border p-3',
            value === v.voiceId ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent'
          )}
        >
          <input
            type="radio"
            name="voice"
            checked={value === v.voiceId}
            onChange={() => onChange(v.voiceId)}
          />
          <span className="flex-1 text-sm font-medium">{v.name}</span>
          {v.category && <Badge variant="secondary">{v.category}</Badge>}
          {v.previewUrl && (
            // ponytail: native audio element beats a custom play button.
            <audio controls preload="none" src={v.previewUrl} className="h-8 w-48" />
          )}
        </label>
      ))}
      {voices.length === 0 && (
        <p className="text-sm text-muted-foreground">No voices returned by the provider.</p>
      )}
    </div>
  )
}
