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
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Airtalk</CardTitle>
          <CardDescription>We&apos;ll email you a magic link.</CardDescription>
        </CardHeader>
        <CardContent>
          <MagicLinkForm mode="login" initialError={error} />
          <p className="mt-4 text-sm text-muted-foreground">
            New to Airtalk?{' '}
            <Link href="/signup" className="underline hover:text-foreground">
              Start your free setup →
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
