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
})
