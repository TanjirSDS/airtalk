import { serviceClient } from '@airtalk/db'
import { notFound } from 'next/navigation'
import { ShareWidget } from '../../../../components/share-widget'
import { makeEngine } from '../../../../lib/engine'

// Public share page (Phase 11, item 6). Signed-out: /share is in the middleware
// PUBLIC_PREFIXES and the root layout renders the clean canvas when there's no
// org. The agent is looked up by share_token via the service role (unauthenticated
// visitors have no RLS scope); a null/unknown token 404s.
export const dynamic = 'force-dynamic'

export default async function ShareAgentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) notFound()
  const { data: agent } = await serviceClient()
    .from('agents')
    .select('name, provider_agent_id, share_token')
    .eq('share_token', token)
    .maybeSingle()
  if (!agent?.provider_agent_id) notFound()

  const embed = makeEngine().testWidgetEmbed(agent.provider_agent_id)
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Talk to this AI agent right in your browser. Tap the button below to start a call.
        </p>
      </div>
      <ShareWidget embed={embed} />
    </div>
  )
}
