import type { ReactNode } from 'react'
import Link from 'next/link'
import './globals.css'

export const metadata = { title: 'Airtalk' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Airtalk
            </Link>
            <Link href="/agents" className="text-muted-foreground hover:text-foreground">
              Agents
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      </body>
    </html>
  )
}
