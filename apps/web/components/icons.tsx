// Hand-authored icon set — one geometry (1.75 stroke, round caps/joins) for a
// cohesive "fluid" line look, no icon dependency. Server-safe (no hooks) so
// both server pages and the client shell import from here.
import type { SVGProps } from 'react'
import { cn } from '../lib/utils'

function Icon({ className, children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-5 w-5 shrink-0', className)}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  )
}

export type IconProps = SVGProps<SVGSVGElement>

export const DashboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </Icon>
)

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.25a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z" />
  </Icon>
)

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
)

export const AgentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 0 1 18 0" />
    <rect x="2.5" y="12" width="4.5" height="7" rx="1.6" />
    <rect x="17" y="12" width="4.5" height="7" rx="1.6" />
    <path d="M21 18.5v.5a3.5 3.5 0 0 1-3.5 3.5H13" />
  </Icon>
)

export const CampaignIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l4.5 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M15.5 8.5a4.5 4.5 0 0 1 0 7" />
    <path d="M18.5 5.5a8.5 8.5 0 0 1 0 13" />
  </Icon>
)

export const BillingIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.4" />
    <path d="M2.5 9.5h19" />
    <path d="M6 14.5h4" />
  </Icon>
)

export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.6 9a2 2 0 0 0 1.4 1.4L20.5 12l-5.5 1.6A2 2 0 0 0 13.6 15L12 20.5 10.4 15A2 2 0 0 0 9 13.6L3.5 12 9 10.4A2 2 0 0 0 10.4 9L12 3.5z" />
    <path d="M19 4v3M20.5 5.5h-3" />
  </Icon>
)

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

export const TimerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.5h4" />
    <path d="M12 14l3-3" />
    <circle cx="12" cy="14" r="8" />
  </Icon>
)

export const GaugeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 15a8.5 8.5 0 1 1 17 0" />
    <path d="M12 15l4-4" />
    <path d="M3.5 15h1M19.5 15h1M12 6.5v1" />
  </Icon>
)

export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Icon>
)

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Icon>
)

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </Icon>
)

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Icon>
)

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </Icon>
)

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </Icon>
)

export const BookIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H6a2 2 0 0 0-2 2V5.5z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5a2 2 0 0 1 2 2V5.5z" />
  </Icon>
)

export const HashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3 7.5 21M16.5 3 15 21M4 8.5h16M3.5 15.5h16" />
  </Icon>
)

/** Brand mark: an iris tile holding a small static waveform ("the line"). */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid h-9 w-9 place-items-center rounded-[11px] bg-brand text-white shadow-brand',
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        {[6, 3.5, 8.5, 4.5, 6].map((h, i) => (
          <rect
            key={i}
            x={4 + i * 3.6}
            y={12 - h}
            width="2"
            height={h * 2}
            rx="1"
            fill="currentColor"
          />
        ))}
      </svg>
    </span>
  )
}

/** Animated equalizer — the signature "open line" motif. Reduced-motion safe. */
export function Waveform({ className, bars = 5 }: { className?: string; bars?: number }) {
  const heights = [0.5, 0.85, 1, 0.7, 0.55, 0.9, 0.65]
  return (
    <span className={cn('inline-flex h-4 items-end gap-[3px]', className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="eq-bar w-[2.5px] rounded-full bg-current"
          style={{ height: '100%', transform: `scaleY(${heights[i % heights.length]})`, animationDelay: `${i * 0.13}s` }}
        />
      ))}
    </span>
  )
}

/** Pulsing on-air dot, bound to live/active state. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2.5 w-2.5', className)} aria-hidden>
      <span className="live-ping absolute inset-0 rounded-full bg-live" />
      <span className="relative m-auto h-2.5 w-2.5 rounded-full bg-live ring-2 ring-live-soft" />
    </span>
  )
}
