'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Re-runs the server component tree every few seconds — "waiting for webhook"
 *  pages (Stripe checkout confirmation) resolve without a manual reload. */
export function Refresher({ seconds = 4 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(t)
  }, [router, seconds])
  return null
}
