import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

// Shared empty state for pages with no data yet. Server-safe (no hooks) so any
// page can render it. `cta` is usually a <Button asChild><Link>…</Link></Button>
// or plain link; keep it optional.
export function EmptyState({
  icon,
  title,
  description,
  cta,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  cta?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/40 px-6 py-16 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-soft text-brand [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {cta && <div className="mt-5">{cta}</div>}
    </div>
  )
}
