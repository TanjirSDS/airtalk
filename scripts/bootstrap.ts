// Phase 1 bootstrap: create the agent → buy a Twilio number → import + attach
// via ElevenLabs → persist rows → print the live number.
// Run: npm run bootstrap   (needs a filled-in .env.local — see .env.example)
import { config } from 'dotenv'
config({ path: '.env.local' })

import { getEnv, serviceClient } from '@airtalk/db'
import { ElevenLabsEngine, type AgentConfig } from '@airtalk/engine'

const AGENT: AgentConfig = {
  name: "Joe's Plumbing receptionist",
  voiceId: 'cjVigY5qzO86Huf0OWal', // provider default voice; swap after browsing the voice library
  firstMessage:
    "Thanks for calling Joe's Plumbing! I'm the AI assistant — how can I help you today?",
  systemPrompt: `You are the phone receptionist for Joe's Plumbing, a local plumbing company.
Always disclose you are an AI assistant in your greeting.
Business hours: Mon–Fri 8am–6pm, Sat 9am–1pm, closed Sunday.
Services: leak repair, drain cleaning, water heater installation, emergency call-outs.
Your job on every call:
1. Find out what the caller needs.
2. Capture their name, phone number, and the reason for the call.
3. For emergencies outside business hours, tell them the on-call plumber will ring back within 30 minutes.
Stay on-topic (plumbing and this business only). If you cannot help, offer to take a
message so a human can call back. Be brief and friendly.`,
}

async function main() {
  const env = getEnv()
  const engine = new ElevenLabsEngine({
    apiKey: env.ELEVENLABS_API_KEY,
    webhookSecret: env.ELEVENLABS_WEBHOOK_SECRET,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
  })
  const db = serviceClient()
  const twilioAuth =
    'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const twilioBase = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`

  console.log('1/5 creating agent…')
  const { providerAgentId } = await engine.createAgent(AGENT)

  console.log('2/5 buying a US local number via Twilio…')
  const searchRes = await fetch(
    `${twilioBase}/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&PageSize=1`,
    { headers: { Authorization: twilioAuth } }
  )
  if (!searchRes.ok) throw new Error(`Twilio search → ${searchRes.status}: ${await searchRes.text()}`)
  const search = await searchRes.json()
  const candidate = search.available_phone_numbers?.[0]?.phone_number
  if (!candidate) throw new Error('No available Twilio numbers returned')

  const buyRes = await fetch(`${twilioBase}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: { Authorization: twilioAuth, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ PhoneNumber: candidate }),
  })
  if (!buyRes.ok) throw new Error(`Twilio purchase → ${buyRes.status}: ${await buyRes.text()}`)
  const bought = await buyRes.json() // { sid, phone_number }

  console.log(`3/5 importing ${bought.phone_number} into ElevenLabs…`)
  const { providerNumberId } = await engine.importNumber(bought.sid, bought.phone_number)

  console.log('4/5 attaching number to agent…')
  await engine.attachNumber(providerNumberId, providerAgentId)

  console.log('5/5 saving rows…')
  const { data: agentRow, error: agentErr } = await db
    .from('agents')
    .insert({ name: AGENT.name, provider: 'elevenlabs', provider_agent_id: providerAgentId, config: AGENT })
    .select()
    .single()
  if (agentErr) throw agentErr
  const { error: numErr } = await db.from('phone_numbers').upsert(
    {
      agent_id: agentRow.id,
      e164: bought.phone_number,
      twilio_sid: bought.sid,
      provider_number_id: providerNumberId,
      status: 'active',
    },
    { onConflict: 'e164' }
  )
  if (numErr) throw numErr

  console.log(`\n✅ Live! Call ${bought.phone_number} from your phone.`)
  console.log(`   agent: ${providerAgentId}  number: ${providerNumberId}`)
  console.log('   Remember to point the ElevenLabs post-call webhook at /api/webhooks/elevenlabs.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
