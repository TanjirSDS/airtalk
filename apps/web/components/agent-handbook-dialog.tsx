'use client'

// Agent Handbook (Phase 11, item 3b): three tabs of toggleable preset snippets +
// a timezone popover. Every toggle edits the freeform prompt TEXT through managed
// sections (## Handbook via togglePreset; ## Current time here) — the prompt stays
// the source of truth. The builder owns `prompt`; this reflects + mutates it.
import {
  getSection,
  HANDBOOK_PRESETS,
  HANDBOOK_TABS,
  isPresetOn,
  removeSection,
  setSection,
  togglePreset,
  type HandbookTab,
} from '@airtalk/engine/templates'
import { useState } from 'react'
import { ClockIcon } from './icons'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Select } from './ui/select'
import { Switch } from './ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

// Current-time awareness is a system dynamic variable, not a config field
// (verified: system__time_utc / system__timezone). We express it as a managed
// prompt section so it round-trips with the prompt.
const TZ_HEADING = '## Current time'
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
]

function tzDirective(tz: string): string {
  return `The current date and time in UTC is {{system__time_utc}}. This business operates in the ${tz} time zone — convert times to that zone when discussing them with callers.`
}
function currentTz(prompt: string): string | null {
  const body = getSection(prompt, TZ_HEADING)
  return body?.match(/operates in the (\S+) time zone/)?.[1] ?? null
}

export function AgentHandbookDialog({ prompt, onChange }: { prompt: string; onChange: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const tz = currentTz(prompt)
  const activeCount = HANDBOOK_PRESETS.filter((p) => isPresetOn(prompt, p)).length + (tz ? 1 : 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          <span>Agent Handbook</span>
          <span className="text-muted-foreground">{activeCount > 0 ? `${activeCount} on` : 'Configure'}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agent Handbook</DialogTitle>
          <DialogDescription>
            Toggle proven behaviours in and out of the prompt. Each adds a line under
            <code className="mx-1 font-mono">## Handbook</code>; edit or remove it there anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <ClockIcon className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Current-time awareness</div>
              <div className="text-xs text-muted-foreground">
                {tz ? `Knows the time in ${tz}` : 'The agent has no sense of the current time'}
              </div>
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                {tz ? 'Change' : 'Set timezone'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2">
              <Select
                value={tz ?? ''}
                onChange={(e) =>
                  onChange(e.target.value ? setSection(prompt, TZ_HEADING, tzDirective(e.target.value)) : removeSection(prompt, TZ_HEADING))
                }
              >
                <option value="">Off</option>
                {TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </PopoverContent>
          </Popover>
        </div>

        <Tabs defaultValue={HANDBOOK_TABS[0]}>
          <TabsList className="flex-wrap">
            {HANDBOOK_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
          {HANDBOOK_TABS.map((tab: HandbookTab) => (
            <TabsContent key={tab} value={tab} className="space-y-2">
              {HANDBOOK_PRESETS.filter((p) => p.tab === tab).map((preset) => {
                const on = isPresetOn(prompt, preset)
                return (
                  <div key={preset.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="pr-3">
                      <div className="text-sm font-medium">{preset.label}</div>
                      <div className="text-xs text-muted-foreground">{preset.description}</div>
                    </div>
                    <Switch checked={on} onCheckedChange={(v) => onChange(togglePreset(prompt, preset, v))} />
                  </div>
                )
              })}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
