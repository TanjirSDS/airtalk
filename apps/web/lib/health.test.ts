import { describe, expect, it } from 'vitest'
import { downTransitions, parseStatuspage, runHealthChecks } from './health'

describe('runHealthChecks', () => {
  it('all probes pass', async () => {
    const res = await runHealthChecks({ a: async () => {}, b: async () => {} })
    expect(res.ok).toBe(true)
    expect(res.checks.a.ok).toBe(true)
  })

  it('one failing probe fails the whole check but not the others', async () => {
    const res = await runHealthChecks({
      good: async () => {},
      bad: async () => {
        throw new Error('key revoked')
      },
    })
    expect(res.ok).toBe(false)
    expect(res.checks.good.ok).toBe(true)
    expect(res.checks.bad).toEqual({ ok: false, detail: 'key revoked' })
  })

  it('a hung probe times out instead of hanging the health check', async () => {
    const res = await runHealthChecks({ hung: () => new Promise(() => {}) }, 20)
    expect(res.checks.hung.ok).toBe(false)
    expect(res.checks.hung.detail).toContain('timed out')
  })
})

describe('parseStatuspage', () => {
  it('indicator none is healthy', () => {
    expect(parseStatuspage({ status: { indicator: 'none', description: 'All Systems Operational' } })).toEqual({
      ok: true,
    })
  })

  it('any other indicator is down, with the description as detail', () => {
    expect(parseStatuspage({ status: { indicator: 'minor', description: 'Partially Degraded Service' } })).toEqual({
      ok: false,
      detail: 'Partially Degraded Service',
    })
  })

  it('garbage payloads are down, not crashes', () => {
    expect(parseStatuspage(null).ok).toBe(false)
    expect(parseStatuspage({}).ok).toBe(false)
  })
})

describe('downTransitions', () => {
  it('alerts on healthy→down and first-seen down, once per incident', () => {
    const next = {
      elevenlabs: { ok: false, detail: '401' },
      stripe: { ok: true },
      twilio_status: { ok: false, detail: 'degraded' },
    }
    // elevenlabs was up (alert), twilio_status was already down (no repeat alert)
    expect(downTransitions({ elevenlabs: true, stripe: true, twilio_status: false }, next)).toEqual([
      'elevenlabs: 401',
    ])
    // never seen before → alert
    expect(downTransitions({}, next)).toEqual(['elevenlabs: 401', 'twilio_status: degraded'])
  })

  it('recovery produces no alert', () => {
    expect(downTransitions({ elevenlabs: false }, { elevenlabs: { ok: true } })).toEqual([])
  })
})
