'use client'

import type { Voice } from '@airtalk/engine'
import { buildAgentConfig, TEMPLATE_INFO, type TemplateKey } from '@airtalk/engine/templates'
import { useState, useTransition } from 'react'
import { createAgentAction } from '../app/agents/actions'
import {
  BusinessProfileFields,
  EMPTY_PROFILE,
  sanitizeProfile,
  type FormProfile,
} from './business-profile-fields'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { VoicePicker } from './voice-picker'
import { cn } from '../lib/utils'

const STEPS = ['Template', 'Business info', 'Voice', 'Review'] as const

export function AgentWizard({ voices, redirectTo }: { voices: Voice[]; redirectTo?: string }) {
  const [step, setStep] = useState(0)
  const [template, setTemplate] = useState<TemplateKey>('receptionist')
  const [profile, setProfile] = useState<FormProfile>(EMPTY_PROFILE)
  const [voiceId, setVoiceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const clean = sanitizeProfile(profile)
  const canLeaveForm = clean.businessName && clean.industry && clean.hours
  const canNext = [true, !!canLeaveForm, !!voiceId, true][step]

  function create() {
    setError(null)
    startTransition(async () => {
      const seed = { ...clean, voiceId }
      const res = await createAgentAction({
        agentType: 'single',
        template,
        seed,
        agentConfig: buildAgentConfig(template, seed),
        redirectTo,
      })
      if (res?.error) setError(res.error) // on success the action redirects
    })
  }

  return (
    <div className="space-y-6">
      <ol className="flex gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              'rounded-full px-3 py-1',
              i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {TEMPLATE_INFO.map((t) => (
            <Card
              key={t.key}
              onClick={() => setTemplate(t.key)}
              className={cn('cursor-pointer', template === t.key && 'border-primary ring-1 ring-primary')}
            >
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {step === 1 && <BusinessProfileFields value={profile} onChange={setProfile} />}

      {step === 2 && <VoicePicker voices={voices} value={voiceId} onChange={setVoiceId} />}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>Your agent will be created with these settings.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Template</dt>
              <dd>{TEMPLATE_INFO.find((t) => t.key === template)?.name}</dd>
              <dt className="text-muted-foreground">Business</dt>
              <dd>{clean.businessName} ({clean.industry})</dd>
              <dt className="text-muted-foreground">Hours</dt>
              <dd>{clean.hours}</dd>
              <dt className="text-muted-foreground">Services</dt>
              <dd>{clean.services.join(', ') || '—'}</dd>
              <dt className="text-muted-foreground">FAQs</dt>
              <dd>{clean.faqs.length} question{clean.faqs.length === 1 ? '' : 's'}</dd>
              <dt className="text-muted-foreground">Escalation</dt>
              <dd>{clean.escalationNumber ?? '— (will take messages)'}</dd>
              <dt className="text-muted-foreground">Greeting style</dt>
              <dd>{clean.greetingStyle}</dd>
              <dt className="text-muted-foreground">Voice</dt>
              <dd>{voices.find((v) => v.voiceId === voiceId)?.name ?? voiceId}</dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 0 || pending} onClick={() => setStep(step - 1)}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
            Next
          </Button>
        ) : (
          <Button disabled={pending} onClick={create}>
            {pending ? 'Creating…' : 'Create agent'}
          </Button>
        )}
      </div>
    </div>
  )
}
