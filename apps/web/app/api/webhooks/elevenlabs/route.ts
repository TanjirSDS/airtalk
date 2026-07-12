import type { NextRequest } from 'next/server'
import { serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../../lib/engine'
import { handleElevenLabsWebhook } from '../../../../lib/elevenlabs-webhook'

export async function POST(req: NextRequest) {
  const rawBody = await req.text() // raw body needed for HMAC verification
  const res = await handleElevenLabsWebhook(
    rawBody,
    req.headers.get('elevenlabs-signature'),
    makeEngine(),
    serviceClient()
  )
  return new Response(res.body, { status: res.status })
}
