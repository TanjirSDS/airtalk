'use client'

// Phase 12: the settings half of the agent-builder rail. Pure controlled client
// state — everything here is lifted into AgentBuilder and saved by its ONE Save
// (updateAgentAction → one updateAgent + one version row, rule 4). No per-section
// saves. Sections render in the documented handoff order; Functions + Knowledge
// Base live in the server-rendered rail ABOVE this (they use their own actions).
import type { DataCollectionField, SuccessCriterion } from '@airtalk/engine'
import { CALL_DEFAULTS, SPEECH_DEFAULTS } from '@airtalk/engine/templates'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, type KeyboardEvent } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

export interface AgentSettings {
  speech: { stability: number; similarityBoost: number; speed: number }
  keywords: string[]
  call: { maxDurationSecs: number; endOnSilenceSecs: number }
  analysis: { dataCollection: DataCollectionField[]; successCriteria: SuccessCriterion[] }
  widgetPublic: boolean
}

const MAX_ANALYSIS_ROWS = 30 // ElevenLabs caps evaluation criteria at 30 (verified 2026-07-13)

export function SettingsRail({
  settings,
  onChange,
  bare = false,
}: {
  settings: AgentSettings
  onChange: (s: AgentSettings) => void
  /** Drop the card wrapper so this sits as flat sections inside another panel (flow builder). */
  bare?: boolean
}) {
  // Phase 16 deep-link: /qa "Configure QA settings" → ?section=extraction opens
  // the Post-Call Data Extraction section here (single source, no duplicate editor).
  const openExtraction = useSearchParams().get('section') === 'extraction'
  useEffect(() => {
    if (openExtraction)
      document.getElementById('post-call-data-extraction')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [openExtraction])

  const set = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) =>
    onChange({ ...settings, [key]: value })

  // Typed sub-setters for the two analysis lists — keeps the JSX terse and type-safe.
  const dc = settings.analysis.dataCollection
  const sc = settings.analysis.successCriteria
  const setDc = (list: DataCollectionField[]) => set('analysis', { ...settings.analysis, dataCollection: list })
  const setSc = (list: SuccessCriterion[]) => set('analysis', { ...settings.analysis, successCriteria: list })

  return (
    <Accordion
      type="multiple"
      defaultValue={openExtraction ? ['extraction'] : undefined}
      className={bare ? '' : 'rounded-xl border bg-card px-4'}
    >
      {/* Speech Settings */}
      <AccordionItem value="speech">
        <AccordionTrigger>Speech Settings</AccordionTrigger>
        <AccordionContent className="space-y-4">
          <SpeechSlider
            label="Stability"
            hint="Higher is more consistent; lower is more expressive."
            min={0}
            max={1}
            value={settings.speech.stability}
            onChange={(v) => set('speech', { ...settings.speech, stability: v })}
          />
          <SpeechSlider
            label="Similarity"
            hint="How closely to match the original voice."
            min={0}
            max={1}
            value={settings.speech.similarityBoost}
            onChange={(v) => set('speech', { ...settings.speech, similarityBoost: v })}
          />
          <SpeechSlider
            label="Speed"
            hint="1.0 is normal talking speed."
            min={0.7}
            max={1.2}
            value={settings.speech.speed}
            onChange={(v) => set('speech', { ...settings.speech, speed: v })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set('speech', { ...SPEECH_DEFAULTS })}
          >
            Reset to defaults
          </Button>
        </AccordionContent>
      </AccordionItem>

      {/* Realtime Transcription */}
      <AccordionItem value="transcription">
        <AccordionTrigger>Realtime Transcription</AccordionTrigger>
        <AccordionContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Keywords bias the transcriber toward words it might otherwise mishear — product names,
            street names, jargon.
          </p>
          <KeywordInput keywords={settings.keywords} onChange={(k) => set('keywords', k)} />
        </AccordionContent>
      </AccordionItem>

      {/* Call Settings */}
      <AccordionItem value="call">
        <AccordionTrigger>Call Settings</AccordionTrigger>
        <AccordionContent className="space-y-3">
          <div>
            <Label htmlFor="max-duration">Maximum call duration (seconds)</Label>
            <Input
              id="max-duration"
              type="number"
              min={30}
              value={settings.call.maxDurationSecs}
              onChange={(e) =>
                set('call', { ...settings.call, maxDurationSecs: Number(e.target.value) || CALL_DEFAULTS.maxDurationSecs })
              }
            />
          </div>
          <div>
            <Label htmlFor="silence">End call after silence (seconds)</Label>
            <Input
              id="silence"
              type="number"
              min={0}
              placeholder="never"
              value={settings.call.endOnSilenceSecs > 0 ? settings.call.endOnSilenceSecs : ''}
              onChange={(e) => {
                const n = Number(e.target.value)
                set('call', { ...settings.call, endOnSilenceSecs: n > 0 ? n : -1 })
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">Leave blank to never hang up on silence.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Post-Call Data Extraction */}
      <AccordionItem value="extraction" id="post-call-data-extraction">
        <AccordionTrigger>Post-Call Data Extraction</AccordionTrigger>
        <AccordionContent className="space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Data collection</div>
            {dc.map((f, i) => (
              <div key={i} className="space-y-1.5 rounded-md border p-2">
                <div className="flex gap-2">
                  <Input
                    aria-label="Field name"
                    placeholder="Field name"
                    value={f.name}
                    onChange={(e) => setDc(updateList(dc, i, { name: e.target.value }))}
                  />
                  <Select
                    aria-label="Type"
                    className="w-28"
                    value={f.type}
                    onChange={(e) => setDc(updateList(dc, i, { type: e.target.value as DataCollectionField['type'] }))}
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </Select>
                  <Button variant="ghost" size="sm" aria-label="Remove field" onClick={() => setDc(dc.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
                <Input
                  aria-label="Description"
                  placeholder="What to extract (also the instruction to the analyzer)"
                  value={f.description}
                  onChange={(e) => setDc(updateList(dc, i, { description: e.target.value }))}
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={dc.length >= MAX_ANALYSIS_ROWS}
              onClick={() => setDc([...dc, { name: '', type: 'string', description: '' }])}
            >
              + Add field
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Success criteria</div>
            {sc.map((c, i) => (
              <div key={i} className="space-y-1.5 rounded-md border p-2">
                <div className="flex gap-2">
                  <Input
                    aria-label="Criterion name"
                    placeholder="Criterion name"
                    value={c.name}
                    onChange={(e) => setSc(updateList(sc, i, { name: e.target.value }))}
                  />
                  <Button variant="ghost" size="sm" aria-label="Remove criterion" onClick={() => setSc(sc.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
                <Input
                  aria-label="Goal prompt"
                  placeholder="The goal the call is judged against"
                  value={c.prompt}
                  onChange={(e) => setSc(updateList(sc, i, { prompt: e.target.value }))}
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={sc.length >= MAX_ANALYSIS_ROWS}
              onClick={() => setSc([...sc, { name: '', prompt: '' }])}
            >
              + Add criterion
            </Button>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Security */}
      <AccordionItem value="security">
        <AccordionTrigger>Security</AccordionTrigger>
        <AccordionContent>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Public widget</div>
              <p className="text-xs text-muted-foreground">
                On: anyone with the embed or share link can talk to the agent, no sign-in. Off makes
                it private — the public share link and the in-app test call stop working.
              </p>
            </div>
            <Switch checked={settings.widgetPublic} onCheckedChange={(v) => set('widgetPublic', v)} />
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Webhook Settings (placeholder → Integrations, Phase 17) */}
      <AccordionItem value="webhooks">
        <AccordionTrigger>Webhook Settings</AccordionTrigger>
        <AccordionContent>
          <p className="text-xs text-muted-foreground">
            Forward call events to your own endpoint. ElevenLabs post-call webhooks are
            workspace-level, so per-org outbound webhooks are managed in{' '}
            <Link href="/integrations" className="text-brand underline">
              Integrations
            </Link>
            .
          </p>
        </AccordionContent>
      </AccordionItem>

      {/* MCPs — skipped: EL references pre-registered MCP servers by id, not URL. */}
      <AccordionItem value="mcp">
        <AccordionTrigger>MCP Servers</AccordionTrigger>
        <AccordionContent>
          <p className="text-xs text-muted-foreground">
            Model Context Protocol servers give the agent live tools. ElevenLabs references
            servers by an id you register separately, so connecting them is a dedicated flow
            coming in a later release. <Badge variant="outline">Coming soon</Badge>
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function SpeechSlider({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  hint: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider min={min} max={max} step={0.05} value={[value]} onValueChange={([v]) => onChange(v)} />
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function KeywordInput({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !keywords.includes(v)) onChange([...keywords, v])
    setDraft('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && keywords.length) {
      onChange(keywords.slice(0, -1))
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
      {keywords.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
          {k}
          <button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(keywords.filter((x) => x !== k))}>
            ✕
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={keywords.length ? '' : 'Type a word, press Enter'}
        className="min-w-24 flex-1 bg-transparent text-sm focus:outline-none"
      />
    </div>
  )
}

/** Immutable "patch the i-th row" for a list of analysis rows. */
function updateList<T>(list: T[], i: number, patch: Partial<T>): T[] {
  return list.map((row, j) => (j === i ? { ...row, ...patch } : row))
}
