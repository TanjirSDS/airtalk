import { serviceClient } from '@airtalk/db'
import { joinedAgentName } from './call-filters'
import { userClient } from './supabase-server'

// Server-only fetch shared by the /calls drawer (?call=<id>) and the
// /calls/[id] full page, so both render the identical CallDetail component.

export interface ContactRow {
  id: string
  e164: string | null
  first_name: string | null
  last_name: string | null
  external_id: string | null
  notes: string | null
  dnc: boolean
}

export interface LogEntry {
  type: string
  at: string | null
}

export interface CallDetail {
  call: Record<string, any>
  agentName: string | null
  contact: ContactRow | null
  campaign: { name: string | null; vars: Record<string, unknown> | null } | null
  logs: LogEntry[]
  /** No webhook_events for this call → it was inserted by nightly reconciliation. */
  backfilled: boolean
}

export async function fetchCallDetail(id: string): Promise<CallDetail | null> {
  const db = await userClient()
  const { data: call, error } = await db
    .from('calls')
    .select('*, agents(name), contacts(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!call) return null // RLS-scoped: not found === not ours

  // Campaign dynamic vars for outbound calls (Data tab).
  let campaign: CallDetail['campaign'] = null
  if (call.provider_call_id) {
    const { data: cc } = await db
      .from('campaign_contacts')
      .select('vars, campaigns(name)')
      .eq('provider_call_id', call.provider_call_id)
      .maybeSingle()
    if (cc) campaign = { name: joinedAgentName(cc.campaigns), vars: (cc.vars as Record<string, unknown>) ?? null }
  }

  // Logs: webhook_events is service-role-only under RLS (it's org-less). We've
  // already confirmed the caller owns this call via the RLS fetch above, so
  // reading events for THIS conversation_id with the service client is safe.
  let logs: LogEntry[] = []
  if (call.provider_call_id) {
    const { data: events } = await serviceClient()
      .from('webhook_events')
      .select('event_id, processed_at')
      .eq('payload->data->>conversation_id', call.provider_call_id)
    logs = (events ?? [])
      .map((e) => ({ type: String(e.event_id).split(':')[0], at: e.processed_at }))
      .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
  }

  return {
    call,
    agentName: joinedAgentName(call.agents),
    contact: (call.contacts as ContactRow | null) ?? null,
    campaign,
    logs,
    backfilled: logs.length === 0,
  }
}
