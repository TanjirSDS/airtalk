// Phase 10: migrate agents.config (and agent_config_versions.config) to the v2
// freeform-first StoredAgentConfig shape. v1 {template, profile, agentConfig} →
// {agentType, template, seed: profile, agentConfig} (agentConfig untouched);
// bootstrap-era plain AgentConfig → wrapped. Idempotent: normalize is
// deterministic, so a row already in v2 stringifies identically and is skipped —
// run it twice, the second run touches nothing. npm run migrate-agent-config
import { config } from 'dotenv'
config({ path: '.env.local' })

import { serviceClient } from '@airtalk/db'
import { normalizeStoredConfig } from '@airtalk/engine/templates'

// Postgres jsonb canonicalizes key order on storage, so a plain JSON.stringify
// compare would flag every already-v2 row as changed and rewrite it each run.
// Sort keys at every level so "already migrated" is a true no-op on re-runs.
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val as object).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
      : val
  )
}

async function migrateTable(table: 'agents' | 'agent_config_versions') {
  const db = serviceClient()
  // Both tables key on their own `id` (agent_config_versions.id is the pk;
  // agent_id is NOT unique — keying on it would clobber sibling versions).
  const { data, error } = await db.from(table).select('id, config')
  if (error) throw new Error(`${table}: ${error.message}`)

  let migrated = 0
  let skipped = 0
  let failed = 0
  for (const row of data ?? []) {
    if (row.config == null) {
      skipped++
      continue
    }
    let normalized
    try {
      normalized = normalizeStoredConfig(row.config)
    } catch (e) {
      console.warn(`  ! ${table} ${row.id}: ${e instanceof Error ? e.message : e} — left as-is`)
      failed++
      continue
    }
    if (stable(normalized) === stable(row.config)) {
      skipped++
      continue
    }
    const { error: updErr } = await db.from(table).update({ config: normalized }).eq('id', row.id)
    if (updErr) throw new Error(`${table} ${row.id}: ${updErr.message}`)
    migrated++
  }
  console.log(`${table}: ${migrated} migrated, ${skipped} already v2/empty, ${failed} unrecognized`)
}

async function main() {
  await migrateTable('agents')
  await migrateTable('agent_config_versions')
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
