// CSP: 'self' plus exactly what the app needs — Supabase auth from the browser,
// the ElevenLabs test-call widget (unpkg script + wss audio), voice previews /
// recordings (provider CDN hosts vary, so media stays https:).
// ponytail: 'unsafe-inline' script-src because Next inlines bootstrap scripts —
// move to nonces if a pen test demands it.
// Dev needs 'unsafe-eval' (webpack eval devtool) + the local Supabase origin and
// the HMR websocket; production stays strict.
const dev = process.env.NODE_ENV === 'development'
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://unpkg.com${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.elevenlabs.io wss://api.elevenlabs.io https://api.us.elevenlabs.io wss://api.us.elevenlabs.io https://*.ingest.sentry.io${dev ? ' http://127.0.0.1:55321 ws://127.0.0.1:55321 ws://localhost:3000' : ''}`,
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
