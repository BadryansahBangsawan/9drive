import { useEffect, useMemo, useState } from 'react'
import { Folder, History, Link2, Trash2, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/drive/PageHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { activityCategory, describeActivity } from '@/lib/activity'
import type { ActivityCategory } from '@/lib/activity'
import { apiFetch } from '@/lib/api'
import { groupByDay } from '@/lib/dates'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'

type AuditLog = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  metadata: string | null
  createdAt: string
}

type Filter = 'all' | 'uploads' | 'sharing' | 'deleted'

const filterOptions: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'uploads', label: 'Uploads' },
  { value: 'sharing', label: 'Sharing' },
  { value: 'deleted', label: 'Deleted' },
]

const categoryIcon: Record<ActivityCategory, LucideIcon> = {
  uploads: Upload,
  sharing: Link2,
  deleted: Trash2,
  other: Folder,
}

function timeOf(value: string) {
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

export function ActivityLogPage() {
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  async function loadLogs() {
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ logs: AuditLog[] }>('/audit-logs')
      setLogs(data.logs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setBreadcrumb([{ label: 'Activity' }])
    setHeaderActions(null)
    loadLogs().catch(() => undefined)
  }, [])

  const groups = useMemo(() => {
    const visible = logs.filter((l) => filter === 'all' || activityCategory(l.action) === filter)
    return groupByDay(visible, (l) => l.createdAt, new Date())
  }, [logs, filter])

  return (
    <>
      <PageHeader title="Activity" description="Recent changes in your workspace." actions={<Segmented value={filter} onChange={setFilter} options={filterOptions} />} />
      {error ? (
        <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-danger px-4 py-3 text-[13px] text-danger">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => loadLogs().catch(() => undefined)}>Retry</Button>
        </div>
      ) : null}
      {loading ? (
        <p className="mt-10 text-center text-[13px] text-muted">Loading activity…</p>
      ) : !error && groups.length === 0 ? (
        <EmptyState
          icon={<History className="h-4 w-4" strokeWidth={1.5} />}
          title={filter === 'all' ? 'No activity yet' : 'Nothing here'}
          description={filter === 'all' ? 'Uploads, sharing and deletions will appear here.' : 'No events match this filter.'}
          action={filter === 'all' ? undefined : <Button variant="secondary" size="sm" onClick={() => setFilter('all')}>Show all</Button>}
        />
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">{group.label}</h2>
              <ul className="divide-y divide-border border-y border-border">
                {group.items.map((log) => {
                  const Icon = categoryIcon[activityCategory(log.action)]
                  const { verb, object, suffix } = describeActivity(log)
                  return (
                    <li key={log.id} className="flex min-h-12 items-center gap-3 px-2 py-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted" aria-hidden="true">
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </span>
                      <p className="min-w-0 flex-1 truncate text-[13px] text-muted">
                        {verb}
                        {object ? <> <span className="font-medium text-text">{object}</span></> : null}
                        {suffix ? <> {suffix}</> : null}
                      </p>
                      <time dateTime={log.createdAt} className="shrink-0 text-[13px] tabular-nums text-subtle">{timeOf(log.createdAt)}</time>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
