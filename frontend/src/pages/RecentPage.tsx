import { useEffect, useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { FileIcon } from '@/components/drive/FileIcon'
import { PageHeader } from '@/components/drive/PageHeader'
import { StoredIn } from '@/components/drive/StoredIn'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { accountLabel } from '@/lib/accounts'
import { apiFetch, formatBytes } from '@/lib/api'
import { groupByDay } from '@/lib/dates'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'

type RecentFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  createdAt: string
  folder?: { id: string; name: string } | null
  connectedAccount?: { id: string; email: string; provider: string; displayName?: string | null } | null
}

const DAY = 86_400_000

function kindOf(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image' as const
  if (mimeType.startsWith('video/')) return 'video' as const
  if (mimeType.includes('pdf')) return 'pdf' as const
  return 'doc' as const
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function timeLabel(createdAt: string, now: Date) {
  const date = new Date(createdAt)
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY)
  const clock = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (days <= 1) return `Uploaded ${clock}`
  return `Uploaded ${new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)} ${clock}`
}

export function RecentPage() {
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [files, setFiles] = useState<RecentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ files: RecentFile[] }>('/files')
      setFiles(data.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recent files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setBreadcrumb([{ label: 'Recent' }])
    setHeaderActions(null)
    load().catch(() => undefined)
  }, [])

  const now = useMemo(() => new Date(), [files])
  const groups = useMemo(() => {
    const cutoff = startOfDay(now) - 6 * DAY
    const recent = files
      .filter((f) => new Date(f.createdAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return groupByDay(recent, (f) => f.createdAt, now)
  }, [files, now])

  return (
    <>
      <PageHeader title="Recent" description="Files uploaded in the last 7 days." />
      {error ? (
        <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-danger px-4 py-3 text-[13px] text-danger">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => load().catch(() => undefined)}>Retry</Button>
        </div>
      ) : null}
      {loading ? (
        <p className="mt-10 text-center text-[13px] text-muted">Loading recent files…</p>
      ) : !error && groups.length === 0 ? (
        <EmptyState icon={<Clock className="h-4 w-4" strokeWidth={1.5} />} title="Nothing recent" description="Files you upload in the next 7 days will show up here." />
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">{group.label}</h2>
              <ul className="divide-y divide-border border-y border-border">
                {group.items.map((file) => (
                  <li key={file.id} className="flex h-12 items-center gap-3 px-2 hover:bg-hover">
                    <FileIcon kind={kindOf(file.mimeType)} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={file.name}>{file.name}</span>
                    <span className="hidden w-48 min-w-0 text-[13px] text-muted md:block">
                      {file.connectedAccount ? (
                        <StoredIn provider={file.connectedAccount.provider} label={accountLabel(file.connectedAccount)} />
                      ) : (
                        <span className="truncate">{file.folder?.name ?? 'My Drive'}</span>
                      )}
                    </span>
                    <span className="hidden w-20 text-right text-[13px] tabular-nums text-muted sm:block">{formatBytes(file.sizeBytes)}</span>
                    <span className="w-28 text-right text-[13px] tabular-nums text-muted">{timeLabel(file.createdAt, now)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
