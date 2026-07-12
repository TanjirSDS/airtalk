// Cal.com API v2 client (per-org API key, entered by the owner) + the
// provider-neutral tool definition the booking agent calls mid-conversation.
// Endpoints/headers verified against https://cal.com/docs/api-reference/v2 on
// 2026-07-12: the cal-api-version header is versioned PER ENDPOINT.

import type { AgentTool } from '@airtalk/engine'

const BASE = 'https://api.cal.com/v2'

async function calReq<T>(
  apiKey: string,
  version: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'cal-api-version': version,
      ...(init?.body !== undefined && { 'content-type': 'application/json' }),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.status !== 'success') {
    throw new Error(
      `Cal.com ${path} → ${res.status}: ${json?.error?.message ?? JSON.stringify(json).slice(0, 300)}`
    )
  }
  return json.data as T
}

/** Open slots keyed by local date: { '2026-07-14': [{ start: '...+02:00' }] }. */
export function listSlots(
  apiKey: string,
  eventTypeId: number,
  startDate: string, // YYYY-MM-DD
  endDate: string,
  timeZone: string
): Promise<Record<string, { start: string }[]>> {
  const qs = new URLSearchParams({
    eventTypeId: String(eventTypeId),
    start: startDate,
    end: endDate,
    timeZone,
  })
  return calReq(apiKey, '2024-09-04', `/slots?${qs}`)
}

/** Books the slot; attendee email is optional under version 2026-02-25 (phone-only OK). */
export function createBooking(
  apiKey: string,
  eventTypeId: number,
  startISO: string,
  attendee: { name: string; timeZone: string; phoneNumber?: string }
): Promise<{ uid: string; status: string; start: string; end: string }> {
  return calReq(apiKey, '2026-02-25', '/bookings', {
    method: 'POST',
    body: { start: startISO, eventTypeId, attendee: { ...attendee, language: 'en' } },
  })
}

/** The key's event types — connect-time validation + eventTypeId picker. */
export async function listEventTypes(
  apiKey: string
): Promise<{ id: number; title: string; lengthInMinutes: number }[]> {
  const me = await calReq<{ username: string }>(apiKey, '2024-06-14', '/me')
  return calReq(apiKey, '2024-06-14', `/event-types?username=${encodeURIComponent(me.username)}`)
}

export const TOOLS_SECRET_HEADER = 'x-airtalk-tools-secret'

/** The check_availability_and_book tool attached to booking-template agents. */
export function calcomBookingTool(agentId: string, appUrl: string, secret: string): AgentTool {
  return {
    name: 'check_availability_and_book',
    description:
      'Check real appointment availability and book a slot on the business calendar. ' +
      'Call with action "check" and a date first; offer the returned slots to the caller; ' +
      'after they choose, call again with action "book", the exact slot start time, and their name.',
    url: `${appUrl}/api/tools/calcom?agent=${agentId}`,
    secretHeader: { name: TOOLS_SECRET_HEADER, value: secret },
    params: [
      {
        name: 'action',
        type: 'string',
        description: '"check" to list open slots for a date, "book" to book a chosen slot.',
        required: true,
      },
      {
        name: 'date',
        type: 'string',
        description: 'Day to check, YYYY-MM-DD in the caller\'s local time. Required for "check".',
      },
      {
        name: 'start',
        type: 'string',
        description: 'Exact ISO start time of the chosen slot, exactly as returned by "check". Required for "book".',
      },
      { name: 'name', type: 'string', description: 'The caller\'s full name. Required for "book".' },
    ],
    systemParams: [
      { name: 'conversation_id', source: 'conversationId' },
      { name: 'caller_phone', source: 'callerId' },
    ],
  }
}
