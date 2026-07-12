import { serve } from 'inngest/next'
import { inngest } from '../../../lib/inngest'
import { functions } from '../../../lib/jobs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // reconcile can page through a day of provider calls

// Inngest calls back here to execute functions (signed with INNGEST_SIGNING_KEY).
export const { GET, POST, PUT } = serve({ client: inngest, functions })
