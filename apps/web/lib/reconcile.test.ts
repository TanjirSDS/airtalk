import { describe, expect, it } from 'vitest'
import type { ProviderCall } from '@airtalk/engine'
import { diffCalls } from './reconcile'

const call = (id: string, secs: number): ProviderCall => ({
  providerCallId: id,
  providerAgentId: 'agent_1',
  direction: 'inbound',
  startedAt: '2026-07-11T10:00:00.000Z',
  durationSecs: secs,
  status: 'done',
})

describe('diffCalls (reconciliation money math)', () => {
  it('reports nothing when tables agree', () => {
    const d = diffCalls([call('a', 60)], [{ provider_call_id: 'a', duration_secs: 60 }])
    expect(d.missing).toHaveLength(0)
    expect(d.durationFixes).toHaveLength(0)
    expect(d.discrepancySecs).toBe(0)
  })

  it('finds calls the webhook missed', () => {
    const d = diffCalls([call('a', 60), call('b', 90)], [{ provider_call_id: 'a', duration_secs: 60 }])
    expect(d.missing.map((m) => m.providerCallId)).toEqual(['b'])
    expect(d.discrepancySecs).toBe(90)
  })

  it('corrects drifted durations, counting absolute drift', () => {
    const d = diffCalls(
      [call('a', 100), call('b', 50)],
      [
        { provider_call_id: 'a', duration_secs: 40 }, // 60 short
        { provider_call_id: 'b', duration_secs: 80 }, // 30 long
      ]
    )
    expect(d.durationFixes).toEqual([
      { providerCallId: 'a', from: 40, to: 100 },
      { providerCallId: 'b', from: 80, to: 50 },
    ])
    expect(d.discrepancySecs).toBe(90)
  })

  it('treats a null local duration as 0', () => {
    const d = diffCalls([call('a', 60)], [{ provider_call_id: 'a', duration_secs: null }])
    expect(d.durationFixes).toEqual([{ providerCallId: 'a', from: 0, to: 60 }])
  })

  it('ignores local calls the provider does not list (other days)', () => {
    const d = diffCalls([call('a', 60)], [
      { provider_call_id: 'a', duration_secs: 60 },
      { provider_call_id: 'z', duration_secs: 999 },
    ])
    expect(d.discrepancySecs).toBe(0)
  })
})
