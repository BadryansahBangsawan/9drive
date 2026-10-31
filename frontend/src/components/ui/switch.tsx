import { cn } from '@/lib/utils'

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        checked ? 'bg-primary' : 'bg-selected',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-bg border border-border transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-[1px]',
        )}
      />
    </button>
  )
}
