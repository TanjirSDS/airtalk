'use client'

// Searchable voice picker (Phase 11): replaces the inline <select>. Table of
// name / category / preview, category filter, and a curated Recommended row.
// Provider-neutral — it only consumes the Voice[] the engine returns.
import type { Voice } from '@airtalk/engine'
import { useMemo, useRef, useState } from 'react'
import { SearchIcon } from './icons'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { cn } from '../lib/utils'

// Classic ElevenLabs public voices — a sensible starting shortlist. Any that
// aren't in this workspace's list are simply skipped.
// ponytail: swap for house picks once we know which voices ship by default.
const RECOMMENDED_VOICE_IDS = [
  '21m00Tcm4TlvDq8ikWAM', // Rachel
  'EXAVITQu4vr4xnSDxMaL', // Sarah
  'pNInz6obpgDJa32McL9L', // Adam
  'ErXwobaYiN019PkySvjV', // Antoni
  'TxGEqnHWrfWFTfGW9XjX', // Josh
  'AZnzlk1XvdvUeBnXmlld', // Domi
]

function PreviewButton({ url }: { url: string | null }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  if (!url) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        if (!ref.current) {
          ref.current = new Audio(url)
          ref.current.onended = () => setPlaying(false)
        }
        if (playing) {
          ref.current.pause()
          setPlaying(false)
        } else {
          ref.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
        }
      }}
    >
      {playing ? 'Stop' : 'Play'}
    </Button>
  )
}

export function VoicePickerDialog({
  voices,
  value,
  onChange,
}: {
  voices: Voice[]
  value: string
  onChange: (voiceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(voices.map((v) => v.category).filter(Boolean) as string[])).sort()],
    [voices]
  )
  const recommended = useMemo(
    () => RECOMMENDED_VOICE_IDS.map((id) => voices.find((v) => v.voiceId === id)).filter(Boolean) as Voice[],
    [voices]
  )
  const filtered = useMemo(
    () =>
      voices.filter(
        (v) =>
          (category === 'All' || v.category === category) &&
          v.name.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [voices, category, query]
  )

  const current = voices.find((v) => v.voiceId === value)

  function pick(id: string) {
    onChange(id)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          <span className="truncate">{current?.name ?? value ?? 'Choose a voice'}</span>
          <span className="text-muted-foreground">Change</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a voice</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search voices"
              className="pl-8"
            />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'All' ? 'All categories' : c}
              </option>
            ))}
          </Select>
        </div>

        <div className="max-h-[52vh] overflow-y-auto">
          {recommended.length > 0 && category === 'All' && !query && (
            <div className="mb-4">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand">Recommended</div>
              <VoiceTable voices={recommended} value={value} onPick={pick} />
            </div>
          )}
          <VoiceTable voices={filtered} value={value} onPick={pick} />
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No matching voices.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VoiceTable({ voices, value, onPick }: { voices: Voice[]; value: string; onPick: (id: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead className="w-24">Preview</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {voices.map((v) => (
          <TableRow
            key={v.voiceId}
            onClick={() => onPick(v.voiceId)}
            className={cn('cursor-pointer', value === v.voiceId && 'bg-brand-soft')}
          >
            <TableCell className="font-medium">
              {v.name}
              {value === v.voiceId && <span className="ml-2 text-brand">✓</span>}
            </TableCell>
            <TableCell>{v.category && <Badge variant="secondary">{v.category}</Badge>}</TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
              <PreviewButton url={v.previewUrl} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
