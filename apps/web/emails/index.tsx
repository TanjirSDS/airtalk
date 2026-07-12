import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Text } from '@react-email/components'
import type { ReactElement, ReactNode } from 'react'

// All transactional emails in one file — they share one shell and are each a
// handful of lines. Sent via lib/email.ts (Resend renders the React tree).
// The magic-link email is NOT here: Supabase Auth sends it through its own
// mailer (point Supabase at Resend SMTP in the dashboard — see .env.example).

const body = { backgroundColor: '#f6f6f6', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }
const card = { backgroundColor: '#ffffff', borderRadius: 8, margin: '40px auto', padding: 32, maxWidth: 520 }
const muted = { color: '#666666', fontSize: 13 }

function Shell({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={card}>
          {children}
          <Hr />
          <Text style={muted}>Airtalk — AI voice agents for small business.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export function WelcomeEmail({ orgName, appUrl }: { orgName: string; appUrl: string }): ReactElement {
  return (
    <Shell preview="Your Airtalk workspace is ready">
      <Heading as="h2">Welcome to Airtalk</Heading>
      <Text>
        Your workspace <strong>{orgName}</strong> is ready. Finish setup — pick a plan, create your
        agent, and get a phone number — and your AI receptionist starts answering calls today.
      </Text>
      <Text>
        <Link href={`${appUrl}/signup/plan`}>Continue setup →</Link>
      </Text>
    </Shell>
  )
}

export function UsageWarnEmail(props: { orgName: string; minutesUsed: number; capMinutes: number; appUrl: string }): ReactElement {
  return (
    <Shell preview="You've used 80% of your Airtalk minutes">
      <Heading as="h2">80% of your minutes used</Heading>
      <Text>
        <strong>{props.orgName}</strong> has used {Math.round(props.minutesUsed)} of its{' '}
        {props.capMinutes} included minutes this month. When the cap is reached your agents pause
        (or bill overage, per your settings).
      </Text>
      <Text>
        <Link href={`${props.appUrl}/billing`}>Review your plan →</Link>
      </Text>
    </Shell>
  )
}

export function UsageCappedEmail(props: { orgName: string; capMinutes: number; policy: string; appUrl: string }): ReactElement {
  const paused = props.policy === 'pause'
  return (
    <Shell preview="Your Airtalk minute cap was reached">
      <Heading as="h2">Minute cap reached</Heading>
      <Text>
        <strong>{props.orgName}</strong> used all {props.capMinutes} included minutes this month.{' '}
        {paused
          ? 'Your agents are paused and stop answering calls until next month or a plan upgrade.'
          : 'Extra minutes now bill as overage at your plan rate.'}
      </Text>
      <Text>
        <Link href={`${props.appUrl}/billing`}>{paused ? 'Upgrade to resume →' : 'View usage →'}</Link>
      </Text>
    </Shell>
  )
}

export function PaymentFailedEmail(props: { orgName: string; graceDays: number; appUrl: string }): ReactElement {
  return (
    <Shell preview="Action needed: Airtalk payment failed">
      <Heading as="h2">Payment failed</Heading>
      <Text>
        We couldn&apos;t charge the card on file for <strong>{props.orgName}</strong>. Update your
        payment method within {props.graceDays} days or your agents will be paused.
      </Text>
      <Text>
        <Link href={`${props.appUrl}/billing`}>Fix payment →</Link>
      </Text>
    </Shell>
  )
}

export interface WeeklySummaryProps {
  orgName: string
  calls: number
  minutes: number
  outcomes: { outcome: string; count: number }[]
  topQuestions: string[]
  appUrl: string
}

export function WeeklySummaryEmail(p: WeeklySummaryProps): ReactElement {
  return (
    <Shell preview={`${p.calls} calls, ${Math.round(p.minutes)} minutes this week`}>
      <Heading as="h2">Your week on Airtalk</Heading>
      <Text>
        <strong>{p.orgName}</strong> handled <strong>{p.calls}</strong> call{p.calls === 1 ? '' : 's'} (
        {Math.round(p.minutes)} minutes) in the last 7 days.
      </Text>
      {p.outcomes.length > 0 && (
        <>
          <Text style={{ marginBottom: 4 }}>
            <strong>Outcomes</strong>
          </Text>
          {p.outcomes.map((o) => (
            <Text key={o.outcome} style={{ margin: '2px 0' }}>
              {o.outcome.replace('_', ' ')}: {o.count}
            </Text>
          ))}
        </>
      )}
      {p.topQuestions.length > 0 && (
        <>
          <Text style={{ marginBottom: 4 }}>
            <strong>Callers asked about</strong>
          </Text>
          {p.topQuestions.map((q, i) => (
            <Text key={i} style={{ margin: '2px 0' }}>
              • {q}
            </Text>
          ))}
        </>
      )}
      <Text>
        <Link href={`${p.appUrl}/dashboard`}>Open your dashboard →</Link>
      </Text>
    </Shell>
  )
}

export interface AgentLearningProps {
  orgName: string
  /** One entry per agent that got suggestions this week. */
  agents: { agentId: string; agentName: string; titles: string[] }[]
  totalSuggestions: number
  appUrl: string
}

/** Phase 8: weekly "your agent learned" digest. Suggestions always start
 *  pending (there is no auto-apply), so the email lists them for review. */
export function AgentLearningEmail(p: AgentLearningProps): ReactElement {
  return (
    <Shell preview={`${p.totalSuggestions} new suggestions from last week's calls`}>
      <Heading as="h2">
        Your agent learned {p.totalSuggestions} new thing{p.totalSuggestions === 1 ? '' : 's'} this week
      </Heading>
      <Text>
        From last week&apos;s calls for <strong>{p.orgName}</strong>, Airtalk drafted improvements
        to your agent{p.agents.length === 1 ? '' : 's'}. Nothing changes until you review and
        apply them.
      </Text>
      {p.agents.map((a) => (
        <div key={a.agentId}>
          <Text style={{ marginBottom: 4 }}>
            <strong>{a.agentName}</strong>
          </Text>
          {a.titles.slice(0, 5).map((t, i) => (
            <Text key={i} style={{ margin: '2px 0' }}>
              • {t}
            </Text>
          ))}
          <Text>
            <Link href={`${p.appUrl}/agents/${a.agentId}/learning`}>Review and apply →</Link>
          </Text>
        </div>
      ))}
    </Shell>
  )
}
