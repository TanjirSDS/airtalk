import { timingSafeEqual } from 'node:crypto'
import { getEnv, serviceClient } from '@airtalk/db'
import { NextResponse, type NextRequest } from 'next/server'
import { CONSERVATIVE_ZONES, zonesFor } from '../../../../lib/areacode-tz'
import { createBooking, listSlots, TOOLS_SECRET_HEADER } from '../../../../lib/calcom'

export const runtime = 'nodejs'

// The agent's check_availability_and_book tool lands here mid-call (the
// provider POSTs the LLM-filled body). Auth is the static secret header the
// tool was configured with; ?agent=<uuid> says whose Cal.com account to use.
// Errors return 200 with {error} so the agent can recover verbally instead of
// getting a dead tool.

function secretOk(req: NextRequest): boolean {
  const secret = getEnv().AGENT_TOOLS_SECRET
  const got = req.headers.get(TOOLS_SECRET_HEADER)
  if (!secret || !got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

const speak = (body: Record<string, unknown>) => NextResponse.json(body)

export async function POST(req: NextRequest) {
  if (!secretOk(req)) return new NextResponse('unauthorized', { status: 401 })

  const agentId = req.nextUrl.searchParams.get('agent')
  if (!agentId) return speak({ error: 'tool misconfigured: no agent' })

  const db = serviceClient()
  const { data: agent } = await db
    .from('agents')
    .select('org_id, orgs(calcom_api_key, calcom_event_type_id)')
    .eq('id', agentId)
    .maybeSingle()
  const org = agent?.orgs as unknown as { calcom_api_key: string | null; calcom_event_type_id: number | null } | null
  if (!org?.calcom_api_key || !org.calcom_event_type_id) {
    return speak({ error: 'No calendar is connected. Take the booking request as a message instead.' })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return speak({ error: 'invalid request' })
  }

  // Slot times are looked up and booked in the caller's local timezone, inferred
  // from their area code (falls back to Eastern).
  const callerPhone = typeof body.caller_phone === 'string' ? body.caller_phone : ''
  const timeZone = zonesFor(callerPhone)[0] ?? CONSERVATIVE_ZONES[0]

  try {
    if (body.action === 'check') {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '')
        ? (body.date as string)
        : new Date().toISOString().slice(0, 10)
      const byDay = await listSlots(org.calcom_api_key, org.calcom_event_type_id, date, date, timeZone)
      const slots = Object.values(byDay).flat().map((s) => s.start).slice(0, 8)
      if (!slots.length) {
        return speak({ date, timezone: timeZone, slots: [], note: 'No openings that day — ask for another day and check again.' })
      }
      return speak({ date, timezone: timeZone, slots })
    }

    if (body.action === 'book') {
      if (typeof body.start !== 'string' || typeof body.name !== 'string' || !body.name.trim()) {
        return speak({ error: 'To book I need the exact slot start time and the caller\'s name.' })
      }
      const booking = await createBooking(org.calcom_api_key, org.calcom_event_type_id, body.start, {
        name: body.name.trim(),
        timeZone,
        ...(/^\+\d{8,15}$/.test(callerPhone) && { phoneNumber: callerPhone }),
      })
      // The calls row doesn't exist until the post-call webhook — park the ref,
      // the webhook copies it onto the call (migration 0007).
      if (typeof body.conversation_id === 'string' && body.conversation_id) {
        await db
          .from('call_bookings')
          .upsert(
            { provider_call_id: body.conversation_id, booking_ref: booking.uid, org_id: agent!.org_id },
            { onConflict: 'provider_call_id' }
          )
      }
      return speak({ booked: true, start: booking.start, reference: booking.uid })
    }

    return speak({ error: 'unknown action — use "check" or "book"' })
  } catch (e) {
    console.error('calcom tool failed:', e)
    // Slot taken and validation errors both surface as Cal.com 400s — let the
    // agent apologize and offer another slot.
    return speak({ error: 'That time could not be booked. Offer the caller a different slot.' })
  }
}
