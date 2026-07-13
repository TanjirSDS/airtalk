import { redirect } from 'next/navigation'

// Middleware already routes signed-out users to /login and org-less users to
// /signup; a signed-in member lands on the dashboard.
export default function Home() {
  redirect('/dashboard')
}
