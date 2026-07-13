import { redirect } from 'next/navigation'

// Phase 10: creating an agent moved into the "Create an Agent" modal on /agents.
// This route stays as a redirect so old links (and the signup flow's own agent
// step, which still renders the wizard) keep working.
export default function NewAgentPage() {
  redirect('/agents')
}
