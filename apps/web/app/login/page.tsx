import Link from 'next/link'
import { MagicLinkForm } from '../../components/magic-link-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'

// Magic-link only. Login never creates users (shouldCreateUser stays false in
// the action) — new businesses go through /signup.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams // ?error= from a failed/expired magic-link callback
  return (
    <div className="mx-auto max-w-sm">
      <Card className="p-7">
        <CardHeader className="p-0">
          <CardTitle className="text-xl">Sign in to Airtalk</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send you a magic link.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-6">
          <MagicLinkForm mode="login" initialError={error} />
          <p className="mt-5 text-sm text-muted-foreground">
            New to Airtalk?{' '}
            <Link href="/signup" className="font-medium text-brand hover:text-brand-strong">
              Start your free setup →
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
