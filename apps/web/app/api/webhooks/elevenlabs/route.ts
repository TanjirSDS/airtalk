import type { NextRequest } from 'next/server'
import { getEnv, serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../../lib/engine'
import { handleElevenLabsWebhook } from '../../../../lib/elevenlabs-webhook'
import { emit } from '../../../../lib/events'
import { classifyCall } from '../../../../lib/outcome'
import { rateLimit } from '../../../../lib/ratelimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!(await rateLimit('webhook', `elevenlabs:${ip}`)).success) {
    return new Response('rate limited', { status: 429 })
  }
  const rawBody = await req.text() // raw body needed for HMAC verification
  const res = await handleElevenLabsWebhook(
    rawBody,
    req.headers.get('elevenlabs-signature'),
    makeEngine(),
    serviceClient(),
    (transcript) => classifyCall(transcript, getEnv().OPENAI_API_KEY),
    (providerCallId) => emit('call/recorded', { providerCallId })
  )
  return new Response(res.body, { status: res.status })
}
