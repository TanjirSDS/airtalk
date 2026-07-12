import { Inngest } from 'inngest'

// The one Inngest client. Keys come from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
// env vars (the SDK reads them itself); without them send() fails and callers
// fall back to inline behavior — see lib/events.ts.
export const inngest = new Inngest({ id: 'airtalk' })
