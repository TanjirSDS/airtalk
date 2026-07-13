'use client'

// The agent builder (Phase 11): freeform-first. The system-prompt textarea is the
// source of truth; Save = one engine.updateAgent + one new version row. Owns the
// edit state; the server page keys this by current version so a rollback/save
// remounts it with fresh data.
import type { Voice } from '@airtalk/engine'
import { CALL_DEFAULTS, DEFAULT_ANALYSIS, DEFAULT_LLM, MODEL_INFO, modelLabel, SPEECH_DEFAULTS } from '@airtalk/engine/templates'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { toast } from 'sonner'
import { updateAgentAction } from '../app/agents/actions'
import { AgentHandbookDialog } from './agent-handbook-dialog'
import { CustomLlmForm } from './custom-llm-form'
import { ChevronRightIcon, CopyIcon } from './icons'
import { SettingsRail, type AgentSettings } from './settings-rail'
import { ShareDialog } from './share-dialog'
import { TestPanel } from './test-panel'
import { VersionsSheet, type VersionRow } from './versions-sheet'
import { VoicePickerDialog } from './voice-picker-dialog'
import type { WidgetEmbed } from './test-widget'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'

const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' },
]

type WelcomeMode = 'static' | 'user_first' | 'generated'

export interface BuilderConfig {
  name: string
  systemPrompt: string
  firstMessage: string
  voiceId: string
  llm?: string
  language?: string
  customLlm?: { url: string; modelId?: string; apiKeySecretId?: string }
  // Phase 12 settings (see settings-rail.tsx).
  speech?: { stability?: number; similarityBoost?: number; speed?: number }
  transcription?: { keywords?: string[] }
  call?: { maxDurationSecs?: number; endOnSilenceSecs?: number }
  analysis?: AgentSettings['analysis']
  widget?: { public?: boolean }
}

/** Fill the settings accordion from stored config, defaulting anything unset —
 *  so existing (pre-Phase-12) agents show sane values and persist them on save. */
function initSettings(config: BuilderConfig): AgentSettings {
  return {
    speech: {
      stability: config.speech?.stability ?? SPEECH_DEFAULTS.stability,
      similarityBoost: config.speech?.similarityBoost ?? SPEECH_DEFAULTS.similarityBoost,
      speed: config.speech?.speed ?? SPEECH_DEFAULTS.speed,
    },
    keywords: config.transcription?.keywords ?? [],
    call: {
      maxDurationSecs: config.call?.maxDurationSecs ?? CALL_DEFAULTS.maxDurationSecs,
      endOnSilenceSecs: config.call?.endOnSilenceSecs ?? CALL_DEFAULTS.endOnSilenceSecs,
    },
    analysis: structuredClone(config.analysis ?? DEFAULT_ANALYSIS),
    widgetPublic: config.widget?.public ?? true,
  }
}

export function AgentBuilder({
  agentId,
  providerAgentId,
  status,
  agentType,
  config,
  voices,
  embed,
  shareToken,
  versions,
  rate,
  rail,
  simulation,
}: {
  agentId: string
  providerAgentId: string | null
  status: string
  agentType: 'single' | 'flow' | 'custom_llm'
  config: BuilderConfig
  voices: Voice[]
  embed: WidgetEmbed | null
  shareToken: string | null
  versions: VersionRow[]
  rate: { includedCentsPerMin: number; overageCentsPerMin: number; planName: string }
  rail: ReactNode
  /** Phase 16 Simulation section, rendered full-width below the editor. */
  simulation?: ReactNode
}) {
  const isCustom = agentType === 'custom_llm'

  const [name, setName] = useState(config.name)
  const [prompt, setPrompt] = useState(config.systemPrompt)
  const [voiceId, setVoiceId] = useState(config.voiceId)
  const [llm, setLlm] = useState(config.llm || DEFAULT_LLM)
  const [language, setLanguage] = useState(config.language || 'en')
  const [welcome, setWelcome] = useState<WelcomeMode>(config.firstMessage.trim() ? 'static' : 'user_first')
  const [firstMessage, setFirstMessage] = useState(config.firstMessage)
  const initialSettings = useMemo(() => initSettings(config), [config])
  const [settings, setSettings] = useState<AgentSettings>(initialSettings)
  const [pending, startTransition] = useTransition()

  const effectiveFirstMessage = welcome === 'static' ? firstMessage : ''
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(initialSettings)
  const dirty =
    name !== config.name ||
    prompt !== config.systemPrompt ||
    voiceId !== config.voiceId ||
    llm !== (config.llm || DEFAULT_LLM) ||
    language !== (config.language || 'en') ||
    effectiveFirstMessage !== config.firstMessage ||
    settingsDirty

  function save() {
    startTransition(async () => {
      // Phase 12: the whole accordion rides this ONE save — one updateAgent + one
      // version row (rule 4), never per-section saves.
      const res = await updateAgentAction(agentId, {
        name,
        systemPrompt: prompt,
        firstMessage: effectiveFirstMessage,
        voiceId,
        llm,
        language,
        speech: settings.speech,
        transcription: { keywords: settings.keywords },
        call: settings.call,
        analysis: settings.analysis,
        widget: { public: settings.widgetPublic },
      })
      if (res.error) toast.error(res.error)
      else toast.success(`Saved as version ${res.version}`)
    })
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/agents" className="text-muted-foreground hover:text-foreground" aria-label="Back to agents">
          <ChevronRightIcon className="h-5 w-5 rotate-180" />
        </Link>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 max-w-xs border-transparent bg-transparent px-1 text-xl font-semibold hover:border-input focus:border-input"
        />
        <Badge variant="outline">{status}</Badge>
        {dirty && <span className="text-sm text-warn">Unsaved changes</span>}
        <div className="ml-auto flex items-center gap-2">
          <Link className="text-sm text-muted-foreground hover:text-foreground" href={`/agents/${agentId}/learning`}>
            Learning
          </Link>
          <VersionsSheet agentId={agentId} versions={versions} />
          <ShareDialog agentId={agentId} initialToken={shareToken} />
          <Button onClick={save} disabled={pending || !dirty || !name.trim()}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Metadata strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-2.5 text-xs">
        <CopyField label="Airtalk ID" value={agentId} />
        <CopyField label="Provider ID" value={providerAgentId ?? undefined} />
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">${(rate.includedCentsPerMin / 100).toFixed(2)}/min</span>{' '}
          included · ${(rate.overageCentsPerMin / 100).toFixed(2)}/min overage ({rate.planName})
        </span>
        {!isCustom && <Badge variant="secondary">{modelLabel(llm)}</Badge>}
        <Badge variant="secondary">{LANGUAGES.find((l) => l.code === language)?.name ?? language}</Badge>
      </div>

      {/* Body: main editor + right rail */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {/* Config row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Voice</Label>
              <VoicePickerDialog voices={voices} value={voiceId} onChange={setVoiceId} />
            </div>
            <div>
              <Label htmlFor="language">Language</Label>
              <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            {!isCustom && (
              <>
                <div>
                  <Label htmlFor="llm">LLM model</Label>
                  <Select id="llm" value={llm} onChange={(e) => setLlm(e.target.value)}>
                    {MODEL_INFO.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {MODEL_INFO.find((m) => m.id === llm)?.hint}
                  </p>
                </div>
                <div>
                  <Label>Handbook</Label>
                  <AgentHandbookDialog prompt={prompt} onChange={setPrompt} />
                </div>
              </>
            )}
          </div>

          {isCustom ? (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="mb-1 text-sm font-semibold">Custom LLM connection</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                This agent runs on your own model endpoint. Voice, language and sharing still apply.
              </p>
              <CustomLlmForm
                agentId={agentId}
                initial={{
                  url: config.customLlm?.url ?? '',
                  modelId: config.customLlm?.modelId ?? '',
                  hasKey: !!config.customLlm?.apiKeySecretId,
                }}
              />
            </div>
          ) : (
            <>
              <WelcomeControl
                mode={welcome}
                setMode={setWelcome}
                message={firstMessage}
                setMessage={setFirstMessage}
              />
              <PromptEditor value={prompt} onChange={setPrompt} />
            </>
          )}
        </div>

        <aside className="space-y-4">
          {embed && (
            <div className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Test your agent</h2>
              <TestPanel embed={embed} agentId={agentId} />
            </div>
          )}
          {rail}
          <SettingsRail settings={settings} onChange={setSettings} />
        </aside>
      </div>

      {simulation && <div className="mt-5">{simulation}</div>}
    </div>
  )
}

function CopyField({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  const shown = value
  return (
    <button
      type="button"
      className="group flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      onClick={() => {
        if (!value) return
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      <span className="font-medium text-foreground">{label}:</span>
      <code className="font-mono">{shown.length > 24 ? shown.slice(0, 10) + '…' + shown.slice(-6) : shown}</code>
      {value && <CopyIcon className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />}
      {copied && <span className="text-live">copied</span>}
    </button>
  )
}

function WelcomeControl({
  mode,
  setMode,
  message,
  setMessage,
}: {
  mode: WelcomeMode
  setMode: (m: WelcomeMode) => void
  message: string
  setMessage: (s: string) => void
}) {
  const options: { value: WelcomeMode; label: string; disabled?: boolean }[] = [
    { value: 'static', label: 'AI speaks first' },
    { value: 'user_first', label: 'User speaks first' },
    // Generated openings are a Conversational-Flow feature (entry_behavior) —
    // not a first-class single-prompt setting today. Enabled once flows ship.
    { value: 'generated', label: 'AI improvises opening', disabled: true },
  ]
  return (
    <div className="rounded-xl border bg-card p-4">
      <Label className="mb-2 block">Welcome message</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => setMode(o.value)}
            className={
              'rounded-lg border px-3 py-1.5 text-sm transition-colors ' +
              (mode === o.value ? 'border-brand bg-brand-soft text-brand' : 'hover:bg-accent') +
              (o.disabled ? ' cursor-not-allowed opacity-50' : '')
            }
            title={o.disabled ? 'Coming with Conversational Flow' : undefined}
          >
            {o.label}
          </button>
        ))}
      </div>
      {mode === 'static' ? (
        <Input
          className="mt-3"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="The exact first line the agent speaks — must disclose it's an AI."
        />
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          The agent stays silent and waits for the caller to speak first.
        </p>
      )}
    </div>
  )
}

function PromptEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(el.scrollHeight, 320) + 'px'
  }, [value])
  const tokens = Math.ceil(value.length / 4)
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <Label htmlFor="system-prompt">System prompt</Label>
        <span className="text-xs text-muted-foreground">
          {value.length.toLocaleString()} chars · ~{tokens.toLocaleString()} tokens
        </span>
      </div>
      <textarea
        id="system-prompt"
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        spellCheck={false}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        The prompt is the source of truth — saving pushes exactly this text to the provider. Section
        headings like <code className="font-mono">## FAQs</code> are managed by the Handbook and
        learning.
      </p>
    </div>
  )
}
