import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'live' | 'warn'

const variants: Record<Variant, string> = {
  default: 'border-transparent bg-brand-soft text-brand',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'border-border text-muted-foreground',
  destructive: 'border-transparent bg-danger-soft text-destructive',
  live: 'border-transparent bg-live-soft text-live',
  warn: 'border-transparent bg-warn-soft text-warn',
}

export function Badge({
  className,
  variant = 'default',
  dot = false,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: Variant; dot?: boolean }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize',
        variants[variant],
        className
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </div>
  )
}
