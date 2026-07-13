// ponytail: native <select> styled like shadcn — no Radix needed for simple pickers.
import type { SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
