// CSP: 'self' plus exactly what the app needs — Supabase auth from the browser,
// the ElevenLabs test-call widget (unpkg script + wss audio), voice previews /
// recordings (provider CDN hosts vary, so media stays https:).
// ponytail: 'unsafe-inline' script-src because Next inlines bootstrap scripts —
// move to nonces if a pen test demands it.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.elevenlabs.io wss://api.elevenlabs.io https://api.us.elevenlabs.io wss://api.us.elevenlabs.io https://*.ingest.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TS; Next transpiles them.
  transpilePackages: ['@airtalk/db', '@airtalk/engine'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
