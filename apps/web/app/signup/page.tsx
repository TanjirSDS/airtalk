import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MagicLinkForm } from '../../components/magic-link-form'
import { SignupSteps } from '../../components/signup-steps'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { userClient } from '../../lib/supabase-server'

export default async function SignupPage() {
  const db = await userClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (user) redirect('/signup/org') // already signed in — continue the flow

  return (
    <div className="mx-auto mt-10 max-w-xl space-y-6">
      <SignupSteps current={0} />
      <Card>
        <CardHeader>
          <CardTitle>Get your AI receptionist</CardTitle>
          <CardDescription>
            Answer every call, 24/7. Set up takes about five minutes — start with your email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MagicLinkForm mode="signup" />
          <p className="mt-4 text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="underline hover:text-foreground">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
