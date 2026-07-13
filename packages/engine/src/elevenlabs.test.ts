import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ElevenLabsEngine } from './elevenlabs'
import fixture from '../fixtures/post-call-transcription.json'

const engine = new ElevenLabsEngine({
  apiKey: 'test',
  webhookSecret: 'whsec_test',
  twilioAccountSid: 'AC_test',
  twilioAuthToken: 'test',
})

function sign(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
  return `t=${t},v0=${digest}`
}

describe('verifyWebhook', () => {
  const body = JSON.stringify(fixture)

  it('accepts a valid signature', () => {
    expect(engine.verifyWebhook({ rawBody: body, signature: sign(body, 'whsec_test') })).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(engine.verifyWebhook({ rawBody: body + 'x', signature: sign(body, 'whsec_test') })).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(engine.verifyWebhook({ rawBody: body, signature: sign(body, 'whsec_wrong') })).toBe(false)
  })

  it('rejects a stale timestamp', () => {
    const stale = Math.floor(Date.now() / 1000) - 3600
    expect(engine.verifyWebhook({ rawBody: body, signature: sign(body, 'whsec_test', stale) })).toBe(false)
  })

  it('rejects a missing signature', () => {
    expect(engine.verifyWebhook({ rawBody: body, signature: null })).toBe(false)
  })
})

describe('normalizeCallEvent', () => {
  it('maps the post-call fixture to a CallEvent', () => {
    const ev = engine.normalizeCallEvent(fixture)
    expect(ev).toMatchObject({
      providerCallId: 'conv_placeholder00000000000000000',
      direction: 'inbound',
      fromE164: '+15559876543',
      toE164: '+15551230000',
      durationSecs: 42,
      status: 'done',
    })
    expect(ev.startedAt).toBe(new Date(1752300000 * 1000).toISOString())
    expect(Array.isArray(ev.transcript)).toBe(true)
  })

  it('throws on a non post-call payload', () => {
    expect(() => engine.normalizeCallEvent({ type: 'other' })).toThrow()
  })

  it('extracts the post-call analysis block (Phase 12)', () => {
    const ev = engine.normalizeCallEvent(fixture)
    expect(ev.analysis).toMatchObject({ success: true, sentiment: 'neutral' })
    expect(ev.analysis?.data).toMatchObject({ user_sentiment: 'neutral' })
    expect(ev.analysis?.data?.call_summary).toEqual(expect.any(String))
    expect(ev.analysis?.criteria).toEqual([
      { name: 'call_successful', result: 'success', rationale: expect.any(String) },
    ])
  })

  it('omits analysis when the payload carries none', () => {
    const bare = { type: 'post_call_transcription', event_timestamp: 1, data: { conversation_id: 'c', status: 'done' } }
    expect(engine.normalizeCallEvent(bare).analysis).toBeUndefined()
  })
})

// Offline analog of the "save → GET the EL agent → values match" acceptance:
// stub fetch, PATCH the agent, and assert the request body hit the verified paths.
describe('agent config mapping (Phase 12)', () => {
  it('maps every setting onto the verified provider paths', async () => {
    let captured: any
    const orig = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
    }) as unknown as typeof fetch
    try {
      await engine.updateAgent('agent_1', {
        voiceId: 'v1',
        speech: { stability: 0.3, similarityBoost: 0.9, speed: 1.1 },
        transcription: { keywords: ['Airtalk', 'Cal.com'] },
        call: { maxDurationSecs: 300, endOnSilenceSecs: 20 },
        analysis: {
          dataCollection: [{ name: 'Call Summary', type: 'string', description: 'A concise summary.' }],
          successCriteria: [{ name: 'Call Successful', prompt: 'Did it work?' }],
        },
        widget: { public: false },
      })
    } finally {
      globalThis.fetch = orig
    }
    expect(captured.conversation_config.tts).toMatchObject({
      voice_id: 'v1',
      stability: 0.3,
      similarity_boost: 0.9,
      speed: 1.1,
    })
    expect(captured.conversation_config.asr).toEqual({ keywords: ['Airtalk', 'Cal.com'] })
    expect(captured.conversation_config.conversation).toEqual({ max_duration_seconds: 300 })
    expect(captured.conversation_config.turn).toEqual({ silence_end_call_timeout: 20 })
    expect(captured.platform_settings.data_collection).toEqual({
      call_summary: { type: 'string', description: 'A concise summary.' },
    })
    expect(captured.platform_settings.evaluation.criteria).toEqual([
      { id: 'call_successful', name: 'Call Successful', type: 'prompt', conversation_goal_prompt: 'Did it work?' },
    ])
    // public:false ⇒ auth required (enable_auth true)
    expect(captured.platform_settings.auth).toEqual({ enable_auth: true })
  })
})
