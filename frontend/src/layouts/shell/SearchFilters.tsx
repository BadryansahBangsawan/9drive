import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { accountLabel, type ConnectedAccount } from '@/lib/accounts'
import { cn } from '@/lib/utils'

const fieldClass =
  'h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-text outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25'
const labelClass = 'text-[11px] font-medium text-muted'

const mbFromBytes = (raw: string | null) => (raw ? String(Math.round(Number(raw) / (1024 * 1024))) : '')
const dayFromIso = (raw: string | null) => (raw ? raw.split('T')[0] : '')

export function SearchFilters({ accounts }: { accounts: ConnectedAccount[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [kind, setKind] = useState(searchParams.get('kind') ?? '')
  const [accountId, setAccountId] = useState(searchParams.get('accountId') ?? '')
  const [minSize, setMinSize] = useState(mbFromBytes(searchParams.get('minSize')))
  const [maxSize, setMaxSize] = useState(mbFromBytes(searchParams.get('maxSize')))
  const [startDate, setStartDate] = useState(dayFromIso(searchParams.get('startDate')))
  const [endDate, setEndDate] = useState(dayFromIso(searchParams.get('endDate')))
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '')
    setKind(searchParams.get('kind') ?? '')
    setAccountId(searchParams.get('accountId') ?? '')
    setMinSize(mbFromBytes(searchParams.get('minSize')))
    setMaxSize(mbFromBytes(searchParams.get('maxSize')))
    setStartDate(dayFromIso(searchParams.get('startDate')))
    setEndDate(dayFromIso(searchParams.get('endDate')))
  }, [searchParams])

  // Cmd/Ctrl+K focuses the search field; Escape or an outside click closes the filters.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        wrapRef.current?.querySelector('input')?.focus()
      } else if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    function onDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [])

  function baseParams() {
    const next = new URLSearchParams()
    const folderId = searchParams.get('folderId')
    if (folderId && location.pathname === '/all-files') next.set('folderId', folderId)
    const q = query.trim()
    if (q) next.set('q', q)
    return next
  }

  function apply() {
    const next = baseParams()
    if (kind) next.set('kind', kind)
    if (accountId) next.set('accountId', accountId)
    if (minSize) {
      const bytes = Number(minSize) * 1024 * 1024
      if (!isNaN(bytes)) next.set('minSize', String(bytes))
    }
    if (maxSize) {
      const bytes = Number(maxSize) * 1024 * 1024
      if (!isNaN(bytes)) next.set('maxSize', String(bytes))
    }
    if (startDate) next.set('startDate', new Date(startDate).toISOString())
    if (endDate) next.set('endDate', new Date(endDate).toISOString())
    setOpen(false)
    navigate({ pathname: '/all-files', search: next.toString() })
  }

  function clear() {
    setKind('')
    setAccountId('')
    setMinSize('')
    setMaxSize('')
    setStartDate('')
    setEndDate('')
    setOpen(false)
    navigate({ pathname: '/all-files', search: baseParams().toString() })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    apply()
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
      <form onSubmit={submit} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" strokeWidth={1.5} />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files"
          aria-label="Search files"
          className="pl-9 pr-20"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <kbd className="hidden rounded border border-border px-1 text-[11px] text-subtle sm:block">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label="Search filters"
            aria-expanded={open}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              open ? 'text-accent' : 'text-muted',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </form>

      {open && (
        <div className="fixed inset-x-4 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border border-border bg-bg p-4 sm:absolute sm:inset-x-auto sm:left-0 sm:top-11 sm:w-[28rem]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-text">Filters</span>
            <button type="button" onClick={clear} className="text-xs font-medium text-accent hover:underline">Clear all</button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className={labelClass}>File type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className={fieldClass}>
                <option value="">All types</option>
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="pdf">PDF</option>
                <option value="doc">Document</option>
                <option value="archive">Archive</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className={labelClass}>Account</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={fieldClass}>
                <option value="">All accounts</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{accountLabel(acc)}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-1">
              <span className={labelClass}>Size (MB)</span>
              <div className="flex items-center gap-2">
                <input type="number" min="0" placeholder="Min" aria-label="Minimum size in MB" value={minSize} onChange={(e) => setMinSize(e.target.value)} className={fieldClass} />
                <span className="text-xs text-subtle">to</span>
                <input type="number" min="0" placeholder="Max" aria-label="Maximum size in MB" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} className={fieldClass} />
              </div>
            </div>
            <div className="grid gap-1">
              <span className={labelClass}>Date</span>
              <div className="flex items-center gap-2">
                <input type="date" aria-label="Start date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldClass} />
                <span className="text-xs text-subtle">to</span>
                <input type="date" aria-label="End date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldClass} />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={apply}>Apply filters</Button>
          </div>
        </div>
      )}
    </div>
  )
}
