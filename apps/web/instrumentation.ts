// Sentry server init — no-op without a DSN, so local/dev needs no setup.
export async function register() {
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({ dsn: process.env.SENTRY_DSN })
  }
}

// Uncaught errors from App Router requests (pages, routes, server actions).
export async function onRequestError(...args: unknown[]) {
  if (process.env.SENTRY_DSN && process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    return (Sentry.captureRequestError as (...a: unknown[]) => void)(...args)
  }
}
