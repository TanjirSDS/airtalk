import { cn } from '../lib/utils'

const STEPS = ['Account', 'Workspace', 'Plan', 'Agent', 'Number', 'Live'] as const

/** Progress pills across the signup flow; `current` is a 0-based step index. */
export function SignupSteps({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={cn(
            'rounded-full px-3 py-1',
            i === current
              ? 'bg-primary text-primary-foreground'
              : i < current
                ? 'bg-muted text-foreground'
                : 'bg-muted text-muted-foreground'
          )}
        >
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  )
}
