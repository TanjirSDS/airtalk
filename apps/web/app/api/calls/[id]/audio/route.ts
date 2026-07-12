import type { NextRequest } from 'next/server'
import { serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../../../lib/engine'

export const dynamic = 'force-dynamic'

// Recordings live at the provider, not on a public URL — proxy them through
// the engine so the browser's <audio> can play /api/calls/{id}/audio.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { data: call } = await serviceClient()
    .from('calls')
    .select('provider_call_id, recording_url')
    .eq('id', id)
    .maybeSingle()
  if (!call) return new Response('call not found', { status: 404 })
  if (call.recording_url) return Response.redirect(call.recording_url, 302)

  try {
    const { audio, contentType } = await makeEngine().fetchRecording(call.provider_call_id)
    return new Response(audio, {
      headers: {
        'content-type': contentType,
        'content-length': String(audio.byteLength),
        'cache-control': 'private, max-age=86400', // finished-call audio is immutable
      },
    })
  } catch {
    return new Response('recording unavailable', { status: 404 })
  }
}
