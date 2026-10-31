import type { ReactNode } from 'react'

export function SelectionBar({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div role="region" aria-label="Selection actions" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-border bg-accent-soft px-3 py-1.5">
      <span className="text-[13px] font-medium text-text" aria-live="polite">{count} selected</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
