import * as React from 'react'
import { cn } from '@/lib/utils'

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'mono' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted',
        tone === 'mono' && 'font-mono',
      )}
    >
      {children}
    </span>
  )
}
