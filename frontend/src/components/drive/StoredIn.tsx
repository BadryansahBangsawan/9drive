import { cn } from '@/lib/utils'

export function StoredIn({ provider, label }: { provider?: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2" title={label}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', provider === 's3' ? 'bg-s3' : 'bg-drive')} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  )
}
