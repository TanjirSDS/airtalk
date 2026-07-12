import { describe, expect, it, vi } from 'vitest'
import fixture from '../../../packages/engine/fixtures/post-call-transcription.json'
import { buildMessages, classifyCall, parseOutcome } from './outcome'

const transcript = fixture.data.transcript

function fakeOpenAI(content: string) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  ) as unknown as typeof fetch
}

describe('outcome extraction', () => {
  it('builds one prompt line per spoken turn, labeled by speaker', () => {
    const [system, user] = buildMessages(transcript)
    expect(system.content).toContain('lead_captured')
    expect(user.content).toBe(
      [
        "Agent: Thanks for calling Joe's Plumbing, this is an AI assistant. How can I help?",
        'Caller: Hi, my kitchen sink is leaking.',
        'Agent: Sorry to hear that. Can I get your name and number so we can schedule a visit?',
      ].join('\n')
    )
  })

  it('classifies the fixture transcript from the model response', async () => {
    const fetchFn = fakeOpenAI('{"outcome":"lead_captured","summary":"Caller reported a leaking sink; contact details collected."}')
    const result = await classifyCall(transcript, 'sk-test', fetchFn)
    expect(result).toEqual({
      outcome: 'lead_captured',
      summary: 'Caller reported a leaking sink; contact details collected.',
    })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('rejects outcomes outside the enum and non-JSON', () => {
    expect(parseOutcome('{"outcome":"sold_a_car","summary":"x"}')).toBeNull()
    expect(parseOutcome('The outcome is booked.')).toBeNull()
  })

  it('skips silently without an API key or transcript', async () => {
    const fetchFn = fakeOpenAI('unused')
    expect(await classifyCall(transcript, undefined, fetchFn)).toBeNull()
    expect(await classifyCall([], 'sk-test', fetchFn)).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
