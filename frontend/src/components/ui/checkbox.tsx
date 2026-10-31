import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Checkbox({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  'aria-label': string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        checked ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-bg hover:bg-hover',
      )}
    >
      {checked && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
    </button>
  )
}
