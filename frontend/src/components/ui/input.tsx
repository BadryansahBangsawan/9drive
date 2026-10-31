import * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, readOnly, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      readOnly={readOnly}
      className={cn(
        'h-9 w-full rounded-lg border border-border px-3 text-[13px] text-text outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50',
        readOnly ? 'bg-surface' : 'bg-bg',
        className,
      )}
      {...props}
    />
  )
}
