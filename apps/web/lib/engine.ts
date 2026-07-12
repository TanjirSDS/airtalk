import { getEnv } from '@airtalk/db'
import { ElevenLabsEngine, type VoiceEngine } from '@airtalk/engine'

// The one place apps/web picks a provider. Everything else sees VoiceEngine.
export function makeEngine(): VoiceEngine {
  const env = getEnv()
  return new ElevenLabsEngine({
    apiKey: env.ELEVENLABS_API_KEY,
    webhookSecret: env.ELEVENLABS_WEBHOOK_SECRET,
    twilioAccountSid: env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
  })
}
