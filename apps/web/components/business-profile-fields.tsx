'use client'

// The business form, shared by the new-agent wizard and the edit page.
import type { BusinessProfile } from '@airtalk/engine/templates'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Textarea } from './ui/textarea'

export type FormProfile = Omit<BusinessProfile, 'voiceId'>

export const EMPTY_PROFILE: FormProfile = {
  businessName: '',
  industry: '',
  hours: '',
  services: [],
  faqs: [],
  escalationNumber: undefined,
  greetingStyle: 'friendly',
}

/** Trim/drop empties before handing the profile to a template. */
export function sanitizeProfile(p: FormProfile): FormProfile {
  return {
    ...p,
    businessName: p.businessName.trim(),
    industry: p.industry.trim(),
    hours: p.hours.trim(),
    services: p.services.map((s) => s.trim()).filter(Boolean),
    faqs: p.faqs
      .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
      .filter((f) => f.q && f.a),
    escalationNumber: p.escalationNumber?.trim() || undefined,
  }
}

export function BusinessProfileFields({
  value,
  onChange,
}: {
  value: FormProfile
  onChange: (p: FormProfile) => void
}) {
  const set = (patch: Partial<FormProfile>) => onChange({ ...value, ...patch })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input
            id="businessName"
            value={value.businessName}
            onChange={(e) => set({ businessName: e.target.value })}
            placeholder="Bright Smiles Dental"
          />
        </div>
        <div>
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            value={value.industry}
            onChange={(e) => set({ industry: e.target.value })}
            placeholder="dentist"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="hours">Opening hours</Label>
        <Input
          id="hours"
          value={value.hours}
          onChange={(e) => set({ hours: e.target.value })}
          placeholder="Mon–Fri 9am–5pm, Sat 9am–1pm"
        />
      </div>

      <div>
        <Label htmlFor="services">Services (one per line)</Label>
        <Textarea
          id="services"
          rows={4}
          value={value.services.join('\n')}
          onChange={(e) => set({ services: e.target.value.split('\n') })}
          placeholder={'checkups\nteeth whitening\nemergency appointments'}
        />
      </div>

      <div>
        <Label>FAQs</Label>
        <div className="space-y-2">
          {value.faqs.map((f, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={f.q}
                placeholder="Question"
                onChange={(e) =>
                  set({ faqs: value.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })
                }
              />
              <Input
                value={f.a}
                placeholder="Answer"
                onChange={(e) =>
                  set({ faqs: value.faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set({ faqs: value.faqs.filter((_, j) => j !== i) })}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set({ faqs: [...value.faqs, { q: '', a: '' }] })}
          >
            + Add FAQ
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="escalation">Escalation number (optional)</Label>
          <Input
            id="escalation"
            value={value.escalationNumber ?? ''}
            onChange={(e) => set({ escalationNumber: e.target.value || undefined })}
            placeholder="+1 555 000 1111"
          />
        </div>
        <div>
          <Label htmlFor="greetingStyle">Greeting style</Label>
          <Select
            id="greetingStyle"
            value={value.greetingStyle}
            onChange={(e) => set({ greetingStyle: e.target.value as FormProfile['greetingStyle'] })}
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
          </Select>
        </div>
      </div>
    </div>
  )
}
