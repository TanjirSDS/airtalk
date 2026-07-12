import { redirect } from 'next/navigation'
import { NumberPicker } from '../../../components/number-picker'
import { SignupSteps } from '../../../components/signup-steps'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function SignupNumberPage() {
  const org = await activeOrg()
  if (!org) redirect('/signup')

  const db = await userClient()
  const [{ count: agentCount }, { count: numberCount }] = await Promise.all([
    db.from('agents').select('id', { count: 'exact', head: true }).eq('org_id', org.orgId),
    db.from('phone_numbers').select('id', { count: 'exact', head: true }).eq('org_id', org.orgId),
  ])
  if ((agentCount ?? 0) === 0) redirect('/signup/agent')
  if ((numberCount ?? 0) > 0) redirect('/signup/done') // number exists — done

  return (
    <div className="mx-auto mt-10 max-w-xl space-y-6">
      <SignupSteps current={4} />
      <NumberPicker />
    </div>
  )
}
