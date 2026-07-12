'use client'

import { useState, useTransition } from 'react'
import type { AvailableNumber } from '../lib/numbers'
import { buyNumberAction, searchNumbersAction } from '../app/signup/actions'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { cn } from '../lib/utils'

export function NumberPicker() {
  const [areaCode, setAreaCode] = useState('')
  const [numbers, setNumbers] = useState<AvailableNumber[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function search(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await searchNumbersAction(areaCode)
      if (res.error) setError(res.error)
      else {
        setNumbers(res.numbers ?? [])
        setSelected(null)
      }
    })
  }

  function buy() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const res = await buyNumberAction(selected)
      if (res?.error) setError(res.error) // on success the action redirects
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pick your phone number</CardTitle>
        <CardDescription>
          This is the number customers call — your agent answers it. Search by area code or leave
          blank for any US number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={search} className="flex gap-2">
          <Input
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value)}
            placeholder="Area code, e.g. 415"
            inputMode="numeric"
            maxLength={3}
            className="max-w-40"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending && !numbers ? 'Searching…' : 'Search'}
          </Button>
        </form>

        {numbers && (
          <ul className="space-y-2">
            {numbers.map((n) => (
              <li key={n.e164}>
                <button
                  type="button"
                  onClick={() => setSelected(n.e164)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted',
                    selected === n.e164 && 'border-primary ring-1 ring-primary'
                  )}
                >
                  <span className="font-medium">{n.friendly}</span>
                  {(n.locality || n.region) && (
                    <span className="ml-2 text-muted-foreground">
                      {[n.locality, n.region].filter(Boolean).join(', ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {numbers && (
          <Button onClick={buy} disabled={!selected || pending} className="w-full">
            {pending ? 'Setting up…' : selected ? `Claim ${selected}` : 'Select a number'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
