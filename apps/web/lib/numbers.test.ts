import { describe, expect, it } from 'vitest'
import { numberPurchaseBlocked, purchaseNumber, searchAvailableNumbers } from './numbers'

const CREDS = { accountSid: 'ACtest', authToken: 'token' }

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

describe('numberPurchaseBlocked (rule 3: money-loop guards)', () => {
  const ready = { hasSubscription: true, hasAgent: true, existingNumbers: 0 }

  it('allows exactly the ready state', () => {
    expect(numberPurchaseBlocked(ready)).toBeNull()
  })

  it('blocks without a subscription — no pay, no spend', () => {
    expect(numberPurchaseBlocked({ ...ready, hasSubscription: false })).toMatch(/plan/i)
  })

  it('blocks without an agent — a number with nothing answering is waste', () => {
    expect(numberPurchaseBlocked({ ...ready, hasAgent: false })).toMatch(/agent/i)
  })

  it('caps at one number per org', () => {
    expect(numberPurchaseBlocked({ ...ready, existingNumbers: 1 })).toMatch(/already/i)
    expect(numberPurchaseBlocked({ ...ready, existingNumbers: 3 })).toMatch(/already/i)
  })
})

describe('searchAvailableNumbers', () => {
  it('maps the Twilio payload and passes AreaCode through', async () => {
    let calledUrl = ''
    const f: typeof fetch = async (url) => {
      calledUrl = String(url)
      return new Response(
        JSON.stringify({
          available_phone_numbers: [
            { phone_number: '+14155551234', friendly_name: '(415) 555-1234', locality: 'San Francisco', region: 'CA' },
          ],
        }),
        { status: 200 }
      )
    }
    const nums = await searchAvailableNumbers(CREDS, '415', f)
    expect(calledUrl).toContain('AreaCode=415')
    expect(calledUrl).toContain('VoiceEnabled=true')
    expect(nums).toEqual([
      { e164: '+14155551234', friendly: '(415) 555-1234', locality: 'San Francisco', region: 'CA' },
    ])
  })

  it('throws on a Twilio error status', async () => {
    await expect(searchAvailableNumbers(CREDS, '415', fakeFetch(401, {}))).rejects.toThrow('401')
  })
})

describe('purchaseNumber', () => {
  it('returns the sid Twilio assigns', async () => {
    const res = await purchaseNumber(CREDS, '+14155551234', fakeFetch(201, { sid: 'PN123', phone_number: '+14155551234' }))
    expect(res).toEqual({ twilioSid: 'PN123', e164: '+14155551234' })
  })

  it('throws when the number was taken', async () => {
    await expect(purchaseNumber(CREDS, '+14155551234', fakeFetch(400, { message: 'not available' }))).rejects.toThrow(
      '400'
    )
  })
})
