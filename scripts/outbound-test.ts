// Places one outbound test call: npm run outbound-test -- +15551234567
import { config } from 'dotenv'
config({ path: '.env.local' })

import { getEnv, serviceClient } from '@airtalk/db'
import { ElevenLabsEngine } from '@airtalk/engine'

async function main() {
  const toE164 = process.argv[2]
  if (!toE164?.startsWith('+')) {
    console.error('Usage: npm run outbound-test -- +15551234567')
    process.exit(1)
  }

  const env = getEnv()
  const engine = new ElevenLabsEngine({
    apiKey: env.ELEVENLABS_API_KEY,
    webhookSecret: env.ELEVENLABS_WEBHOOK_SECRET,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
  })

  const { data: agent, error } = await serviceClient()
    .from('agents')
    .select('provider_agent_id, name')
    .eq('status', 'active')
    .limit(1)
    .single()
  if (error || !agent?.provider_agent_id) {
    throw new Error('No active agent found — run bootstrap first')
  }

  console.log(`Calling ${toE164} as "${agent.name}"…`)
  // ponytail: single manual test call, no cap needed; campaign caps arrive in Phase 7
  const { providerCallId } = await engine.startOutboundCall(agent.provider_agent_id, toE164)
  console.log(`✅ Call started: ${providerCallId}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
