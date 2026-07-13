'use client'

import { useRouter } from 'next/navigation'
import type { CallDetail as CallDetailData } from '../lib/call-detail-data'
import { CallDetail } from './call-detail'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'

// URL-driven (?call=<id>): the page server-fetches `detail` when the param is
// present, so opening a row is a soft nav and the drawer deep-links.
export function CallDrawer({ detail, closeHref }: { detail: CallDetailData | null; closeHref: string }) {
  const router = useRouter()
  return (
    <Sheet
      open={!!detail}
      onOpenChange={(o) => {
        if (!o) router.push(closeHref, { scroll: false })
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="sr-only">
          <SheetTitle>Call detail</SheetTitle>
        </SheetHeader>
        {detail && (
          <div className="mt-4">
            <CallDetail detail={detail} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
