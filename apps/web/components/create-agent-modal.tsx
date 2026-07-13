'use client'

import {
  buildAgentConfig,
  scratchAgentConfig,
  TEMPLATE_CATEGORIES,
  TEMPLATE_INFO,
  type AgentType,
  type BusinessProfile,
  type TemplateCategory,
  type TemplateKey,
} from '@airtalk/engine/templates'
import { useState, useTransition } from 'react'
import { createAgentAction, generateDraftAction } from '../app/agents/actions'
import { PlusIcon, SparkleIcon } from './icons'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'
import { cn } from '../lib/utils'

type Step = 'type' | 'template'
// A build-from-scratch card and a generate-from-prompt card sit alongside the
// real templates; both persist template=null (nothing seeds them from a registry).
type Choice = TemplateKey | 'scratch' | 'generate'

const TYPE_CARDS: { type: AgentType; name: string; blurb: string; disabled?: boolean; hint?: string }[] = [
  { type: 'single', name: 'Single Prompt', blurb: 'Easy to start. Simple, free-form conversations.' },
  {
    type: 'flow',
    name: 'Conversational Flow',
    blurb: 'Production-ready, deterministic conversations.',
    disabled: true,
    hint: 'Coming soon',
  },
]

export function CreateAgentModal({
  voices,
  defaultVoiceId,
  openaiEnabled,
  atLimit,
  planName,
  maxAgents,
}: {
  voices: { voiceId: string; name: string }[]
  defaultVoiceId: string
  openaiEnabled: boolean
  atLimit: boolean
  planName: string
  maxAgents: number
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('type')
  const [agentType, setAgentType] = useState<AgentType>('single')
  const [showOther, setShowOther] = useState(false)
  const [category, setCategory] = useState<'All' | TemplateCategory>('All')
  const [choice, setChoice] = useState<Choice | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [voiceId, setVoiceId] = useState(defaultVoiceId)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setStep('type')
    setAgentType('single')
    setShowOther(false)
    setCategory('All')
    setChoice(null)
    setBusinessName('')
    setHours('')
    setDescription('')
    setVoiceId(defaultVoiceId)
    setError(null)
  }

  function pickType(t: AgentType) {
    setAgentType(t)
    setStep('template')
  }

  function seedProfile(): BusinessProfile {
    return {
      businessName: businessName.trim() || 'your business',
      industry: '',
      hours: hours.trim(),
      services: [],
      faqs: [],
      greetingStyle: 'friendly',
      voiceId,
    }
  }

  function create() {
    if (!choice) return
    setError(null)
    startTransition(async () => {
      let res
      if (choice === 'generate') {
        const g = await generateDraftAction(description)
        if (g.error || !g.draft) {
          setError(g.error ?? 'Could not generate a draft')
          return
        }
        res = await createAgentAction({
          agentType,
          template: null,
          agentConfig: { ...g.draft, voiceId },
        })
      } else if (choice === 'scratch') {
        res = await createAgentAction({
          agentType,
          template: null,
          agentConfig: scratchAgentConfig({ businessName, hours }, voiceId),
        })
      } else {
        const seed = seedProfile()
        res = await createAgentAction({
          agentType,
          template: choice,
          seed,
          agentConfig: buildAgentConfig(choice, seed),
        })
      }
      // Success redirects to the new agent page; only errors return here.
      if (res?.error) setError(res.error)
    })
  }

  const shownTemplates =
    category === 'All' ? TEMPLATE_INFO : TEMPLATE_INFO.filter((t) => t.category === category)
  const canCreate = !!choice && (choice !== 'generate' || description.trim().length > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="h-4 w-4" />
          Create an Agent
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create an Agent</DialogTitle>
          <DialogDescription>
            {step === 'type'
              ? 'Choose how this agent should run.'
              : 'Start from a template, a blank prompt, or describe your business.'}
          </DialogDescription>
        </DialogHeader>

        {atLimit && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            Your {planName} plan includes {maxAgents} agent{maxAgents === 1 ? '' : 's'} and you&apos;ve
            reached that limit. Upgrade to add more.
          </p>
        )}

        {step === 'type' && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {TYPE_CARDS.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  disabled={c.disabled}
                  onClick={() => pickType(c.type)}
                  className={cn(
                    'rounded-xl border bg-card p-4 text-left transition-all hover:border-brand/50 hover:shadow-pop',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    c.disabled && 'cursor-not-allowed opacity-60 hover:border-border hover:shadow-none'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{c.name}</span>
                    {c.hint && <Badge variant="outline">{c.hint}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{c.blurb}</p>
                </button>
              ))}
            </div>

            {!showOther ? (
              <button
                type="button"
                onClick={() => setShowOther(true)}
                className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Other options
              </button>
            ) : (
              <button
                type="button"
                onClick={() => pickType('custom_llm')}
                className="w-full rounded-xl border bg-card p-4 text-left transition-all hover:border-brand/50 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-semibold">Custom LLM</span>
                <p className="mt-1 text-sm text-muted-foreground">
                  Bring your own model. Starts from a single prompt you can wire up later.
                </p>
              </button>
            )}
          </div>
        )}

        {step === 'template' && (
          <div className="space-y-4">
            <Tabs value={category} onValueChange={(v) => setCategory(v as 'All' | TemplateCategory)}>
              <TabsList className="flex-wrap">
                <TabsTrigger value="All">All</TabsTrigger>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <TabsTrigger key={c} value={c}>
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="grid max-h-[46vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {shownTemplates.map((t) => (
                <ChoiceCard
                  key={t.key}
                  active={choice === t.key}
                  title={t.name}
                  desc={t.description}
                  onClick={() => setChoice(t.key)}
                />
              ))}
              {category === 'All' && (
                <>
                  <ChoiceCard
                    active={choice === 'scratch'}
                    title="Build from scratch"
                    desc="A blank prompt with the required sections — write it yourself."
                    onClick={() => setChoice('scratch')}
                  />
                  {openaiEnabled && (
                    <ChoiceCard
                      active={choice === 'generate'}
                      title="Generate from prompt"
                      desc="Describe your business and we'll draft the agent for you."
                      icon={<SparkleIcon className="h-4 w-4 text-brand" />}
                      onClick={() => setChoice('generate')}
                    />
                  )}
                </>
              )}
            </div>

            {choice === 'generate' ? (
              <div>
                <Label htmlFor="gen-desc">Describe your business and what the agent should handle</Label>
                <Textarea
                  id="gen-desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. We're a two-chair dental practice in Austin. The agent should answer questions about hours and insurance, and take messages for booking requests."
                />
              </div>
            ) : (
              choice && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="biz-name">Business name (optional)</Label>
                    <Input
                      id="biz-name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Bright Smiles Dental"
                    />
                  </div>
                  <div>
                    <Label htmlFor="biz-hours">Opening hours (optional)</Label>
                    <Input
                      id="biz-hours"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                      placeholder="Mon–Fri 9am–5pm"
                    />
                  </div>
                </div>
              )
            )}

            {voices.length > 0 && choice && (
              <div>
                <Label htmlFor="voice">Voice</Label>
                <Select id="voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between">
          {step === 'template' ? (
            <Button variant="outline" disabled={pending} onClick={() => setStep('type')}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 'template' && (
            <Button disabled={!canCreate || atLimit || pending} onClick={create}>
              {pending ? 'Creating…' : 'Create agent'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChoiceCard({
  active,
  title,
  desc,
  icon,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card p-4 text-left transition-all hover:border-brand/50 hover:shadow-pop',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-brand ring-1 ring-brand'
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold">{title}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </button>
  )
}
