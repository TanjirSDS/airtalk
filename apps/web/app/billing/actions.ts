'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { serviceClient } from '@airtalk/db'
import { changePlan, listInvoices, portalUrl, type InvoiceRow } from '../../lib/billing'
import { activeOrg } from '../../lib/org'
import { stripeClient } from '../../lib/stripe'

// Billing writes need the service client (members have read-only RLS on orgs),
// so gate on owner role explicitly.
async function requireOwner() {
  const org = await activeOrg()
  if (!org) redirect('/login')
  if (org.role !== 'owner') throw new Error('only the org owner can change billing')
  return org
}

async function origin() {
  const h = await headers()
  return h.get('origin') ?? `https://${h.get('host')}`
}

export async function choosePlanAction(formData: FormData) {
  const org = await requireOwner()
  const planId = String(formData.get('plan'))
  const interval = formData.get('interval') === 'annual' ? ('annual' as const) : ('monthly' as const)
  const url = await changePlan(serviceClient(), stripeClient(), org.orgId, planId, interval, await origin())
  redirect(url ?? '/billing')
}

export async function portalAction() {
  const org = await requireOwner()
  redirect(await portalUrl(serviceClient(), stripeClient(), org.orgId, await origin()))
}

/** Next page of invoices for the History tab "Load more" (owner-gated). */
export async function loadInvoicesAction(
  startingAfter: string
): Promise<{ invoices: InvoiceRow[]; hasMore: boolean }> {
  const org = await requireOwner()
  return listInvoices(serviceClient(), stripeClient(), org.orgId, { startingAfter, limit: 12 })
}
