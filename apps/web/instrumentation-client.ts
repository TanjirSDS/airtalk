// Sentry browser init (Next.js loads this convention file on the client).
// NEXT_PUBLIC_SENTRY_DSN is inlined at build time; without it this is a no-op.
import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN })
}
