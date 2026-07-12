import type { NextRequest } from 'next/server'
import { getEnv, serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../../lib/engine'
import { handleElevenLabsWebhook } from '../../../../lib/elevenlabs-webhook'
import { classifyCall } from '../../../../lib/outcome'

export async function POST(req: NextRequest) {
  const rawBody = await req.text() // raw body needed for HMAC verification
  const res = await handleElevenLabsWebhook(
    rawBody,
    req.headers.get('elevenlabs-signature'),
    makeEngine(),
    serviceClient(),
    (transcript) => classifyCall(transcript, getEnv().OPENAI_API_KEY)
  )
  return new Response(res.body, { status: res.status })
}
