import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CallDetail } from '../../../components/call-detail'
import { fetchCallDetail } from '../../../lib/call-detail-data'

export const dynamic = 'force-dynamic'

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await fetchCallDetail(id)
  if (!detail) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/calls" className="text-sm text-muted-foreground hover:text-foreground">
        ← All calls
      </Link>
      <CallDetail detail={detail} />
    </div>
  )
}
