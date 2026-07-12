import type { NextRequest } from 'next/server'
import { serviceClient } from '@airtalk/db'
import { applyCallFilters, joinedAgentName, parseCallFilters } from '../../../lib/call-filters'

export const dynamic = 'force-dynamic'

const CHUNK = 1000 // rows fetched per pull — the response streams, never buffers the full set

function cell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  const filters = parseCallFilters(Object.fromEntries(req.nextUrl.searchParams))
  const db = serviceClient()
  const encoder = new TextEncoder()
  let offset = 0

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('date,agent,direction,from,to,duration_secs,outcome,status,summary\n'))
    },
    // One page per pull(), so backpressure from the client throttles the DB reads.
    async pull(controller) {
      const { data, error } = await applyCallFilters(
        db
          .from('calls')
          .select('started_at, direction, from_e164, to_e164, duration_secs, outcome, status, summary, agents(name)'),
        filters
      )
        .order('started_at', { ascending: false })
        .range(offset, offset + CHUNK - 1)
      if (error) {
        controller.error(new Error(error.message))
        return
      }
      for (const r of data) {
        const row = [
          r.started_at,
          joinedAgentName(r.agents),
          r.direction,
          r.from_e164,
          r.to_e164,
          r.duration_secs,
          r.outcome,
          r.status,
          r.summary,
        ]
        controller.enqueue(encoder.encode(row.map(cell).join(',') + '\n'))
      }
      offset += CHUNK
      if (data.length < CHUNK) controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="calls.csv"',
    },
  })
}
