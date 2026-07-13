// Phase 14: create + link a contact for every existing call that has a phone
// number but no contact_id. Idempotent — only touches contact_id-null rows and
// upserts contacts on (org_id, e164), so running it twice reports the same
// counts the second time (0 new links). npm run backfill-contacts
import { config } from 'dotenv'
config({ path: '.env.local' })

import { serviceClient } from '@airtalk/db'
import { backfillOrgContacts } from '../apps/web/lib/contacts'

async function main() {
  const db = serviceClient()
  const { linked } = await backfillOrgContacts(db)
  console.log(`Linked ${linked} call(s) to contacts.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
