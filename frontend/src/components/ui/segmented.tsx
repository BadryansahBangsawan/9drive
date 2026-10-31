import { cn } from '@/lib/utils'

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div role="radiogroup" className="inline-flex gap-0.5 rounded-lg bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value)
              let n = -1
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % options.length
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + options.length) % options.length
              if (n >= 0) {
                e.preventDefault()
                onChange(options[n].value)
                const sib = e.currentTarget.parentElement?.children[n] as HTMLElement | undefined
                sib?.focus()
              }
            }}
            className={cn(
              'h-7 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active ? 'border border-border bg-bg text-text' : 'border border-transparent text-muted hover:text-text',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
