'use client'
import { useRef } from 'react'
import { cn } from '../lib/utils'

// Transcript turn as normalized by the engine (ElevenLabs shape: role/message/time_in_call_secs).
interface Turn {
  role?: string
  message?: string | null
  time_in_call_secs?: number
}

function stamp(secs?: number) {
  if (secs == null) return ''
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export function CallPlayer({ src, transcript }: { src: string; transcript: Turn[] }) {
  const audioRef = useRef<HTMLAudioElement>(null)

  const seek = (secs?: number) => {
    const audio = audioRef.current
    if (!audio || secs == null) return
    audio.currentTime = secs
    audio.play()
  }

  const turns = transcript.filter((t) => t.message)

  return (
    <div className="space-y-4">
      <audio ref={audioRef} controls preload="metadata" src={src} className="w-full" />
      {turns.length === 0 && <p className="text-muted-foreground">No transcript for this call.</p>}
      <ol className="space-y-1">
        {turns.map((t, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => seek(t.time_in_call_secs)}
              title="Play from here"
              className={cn(
                'flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent',
                t.role === 'agent' ? '' : 'bg-muted/50'
              )}
            >
              <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
                {stamp(t.time_in_call_secs)}
              </span>
              <span className="w-14 shrink-0 text-xs font-semibold uppercase text-muted-foreground">
                {t.role === 'agent' ? 'Agent' : 'Caller'}
              </span>
              <span>{t.message}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
