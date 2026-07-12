// Twilio number search + purchase (raw REST, same as scripts/bootstrap.ts —
// rule 1 only fences ElevenLabs; Twilio-the-number-vendor lives here).

export interface TwilioCreds {
  accountSid: string
  authToken: string
}

export interface AvailableNumber {
  e164: string
  friendly: string
  locality: string | null
  region: string | null
}

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

function basicAuth(creds: TwilioCreds) {
  return 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')
}

/** US local voice-capable numbers, optionally filtered by area code. */
export async function searchAvailableNumbers(
  creds: TwilioCreds,
  areaCode: string | null,
  fetchFn: typeof fetch = fetch
): Promise<AvailableNumber[]> {
  const qs = new URLSearchParams({ VoiceEnabled: 'true', PageSize: '10' })
  if (areaCode) qs.set('AreaCode', areaCode)
  const res = await fetchFn(
    `${TWILIO_BASE}/Accounts/${creds.accountSid}/AvailablePhoneNumbers/US/Local.json?${qs}`,
    { headers: { Authorization: basicAuth(creds) } }
  )
  if (!res.ok) throw new Error(`Twilio search → ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return ((json.available_phone_numbers ?? []) as Record<string, string | null>[]).map((n) => ({
    e164: n.phone_number as string,
    friendly: n.friendly_name ?? (n.phone_number as string),
    locality: n.locality ?? null,
    region: n.region ?? null,
  }))
}

/** Buy the number. This starts a monthly charge — callers must pass
 *  numberPurchaseBlocked() first (rule 3). */
export async function purchaseNumber(
  creds: TwilioCreds,
  e164: string,
  fetchFn: typeof fetch = fetch
): Promise<{ twilioSid: string; e164: string }> {
  const res = await fetchFn(`${TWILIO_BASE}/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: { Authorization: basicAuth(creds), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ PhoneNumber: e164 }),
  })
  if (!res.ok) throw new Error(`Twilio purchase → ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return { twilioSid: json.sid, e164: json.phone_number }
}

/** Release a just-bought number (stops its billing) when downstream setup fails. */
export async function releaseNumber(
  creds: TwilioCreds,
  twilioSid: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const res = await fetchFn(
    `${TWILIO_BASE}/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${twilioSid}.json`,
    { method: 'DELETE', headers: { Authorization: basicAuth(creds) } }
  )
  if (!res.ok && res.status !== 404) {
    throw new Error(`Twilio release → ${res.status}: ${await res.text()}`)
  }
}

/**
 * Rule 3: buying numbers spends money — every purchase passes these guards
 * server-side (the UI only mirrors them). Returns the reason, or null when
 * the purchase may proceed.
 */
export function numberPurchaseBlocked(state: {
  hasSubscription: boolean
  hasAgent: boolean
  existingNumbers: number
}): string | null {
  if (!state.hasSubscription) return 'Pick a plan before claiming a number.'
  if (!state.hasAgent) return 'Create your agent before claiming a number.'
  // ponytail: one number per org in self-serve — the cap and the kill switch in
  // one line; multi-number support goes through admin when someone needs it.
  if (state.existingNumbers >= 1) return 'Your workspace already has a phone number.'
  return null
}
