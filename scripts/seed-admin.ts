// Grant platform-admin (support) access: npm run seed-admin -- person@company.com
// Creates the auth user if needed (same as seed-orgs) and inserts admin_users.
import { config } from 'dotenv'
config({ path: '.env.local' })

import { serviceClient } from '@airtalk/db'

async function findUserByEmail(db: ReturnType<typeof serviceClient>, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase()
  if (!email) {
    console.error('usage: npm run seed-admin -- person@company.com')
    process.exit(1)
  }
  const db = serviceClient()
  let user = await findUserByEmail(db, email)
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true })
    if (error) throw error
    user = data.user
    console.log(`created auth user ${email}`)
  }
  const { error } = await db.from('admin_users').upsert({ user_id: user.id })
  if (error) throw error
  console.log(`✅ ${email} is a platform admin (user ${user.id})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
