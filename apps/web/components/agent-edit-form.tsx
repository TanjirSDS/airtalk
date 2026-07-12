'use client'

import type { Voice } from '@airtalk/engine'
import type { BusinessProfile, TemplateKey } from '@airtalk/engine/templates'
import { useState, useTransition } from 'react'
import { updateAgentAction } from '../app/agents/actions'
import {
  BusinessProfileFields,
  sanitizeProfile,
  type FormProfile,
} from './business-profile-fields'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Select } from './ui/select'

export function AgentEditForm({
  agentId,
  template,
  initialProfile,
  voices,
}: {
  agentId: string
  template: TemplateKey
  initialProfile: BusinessProfile
  voices: Voice[]
}) {
  const { voiceId: initialVoice, ...rest } = initialProfile
  const [profile, setProfile] = useState<FormProfile>(rest)
  const [voiceId, setVoiceId] = useState(initialVoice)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setStatus(null)
    startTransition(async () => {
      const res = await updateAgentAction(agentId, {
        template,
        profile: { ...sanitizeProfile(profile), voiceId },
      })
      setStatus(res.error ? `Error: ${res.error}` : `Saved as version ${res.version}`)
    })
  }

  return (
    <div className="space-y-4">
      <BusinessProfileFields value={profile} onChange={setProfile} />
      <div>
        <Label htmlFor="voice">Voice</Label>
        <Select id="voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
          {/* keep the stored voice selectable even if the provider list changes */}
          {!voices.some((v) => v.voiceId === voiceId) && <option value={voiceId}>{voiceId}</option>}
          {voices.map((v) => (
            <option key={v.voiceId} value={v.voiceId}>
              {v.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {status && (
          <span className={status.startsWith('Error') ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
