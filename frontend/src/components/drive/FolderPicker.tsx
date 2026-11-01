import { useEffect, useState } from 'react'
import { Check, Folder } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

type FolderOption = { id: string; name: string; parentName?: string | null }

const RESULT_LIMIT = 50

// Picks a destination folder without loading every folder: an imported Drive can hold tens of
// thousands. Shows the top-level folders, or name matches while the user types.
export function FolderPicker({ value, onChange, label = 'Destination folder' }: { value: string; onChange: (folderId: string) => void; label?: string }) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<FolderOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<FolderOption | null>(null)

  // The name of a preselected folder (e.g. the folder being viewed), which may not be in the list.
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected?.id === value) return
    let cancelled = false
    apiFetch<{ path: { id: string; name: string }[] }>(`/folders/${encodeURIComponent(value)}/path`)
      .then(({ path }) => {
        if (cancelled) return
        const folder = path[path.length - 1]
        setSelected(folder ? { id: folder.id, name: folder.name, parentName: path[path.length - 2]?.name ?? null } : null)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [value, selected?.id])

  useEffect(() => {
    let cancelled = false
    const term = query.trim()
    const timer = window.setTimeout(() => {
      setLoading(true)
      const path = term ? `/folders?q=${encodeURIComponent(term)}&limit=${RESULT_LIMIT}` : '/folders'
      apiFetch<{ folders: FolderOption[] }>(path)
        .then((data) => { if (!cancelled) setOptions(data.folders.slice(0, RESULT_LIMIT)) })
        .catch(() => { if (!cancelled) setOptions([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, term ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  function choose(option: FolderOption | null) {
    setSelected(option)
    onChange(option?.id ?? '')
  }

  const listed = selected && !options.some((option) => option.id === selected.id) && !query.trim() ? [selected, ...options] : options

  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium text-text">{label}</span>
      <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search folders" aria-label={`Search ${label.toLowerCase()}`} />
      <div role="listbox" aria-label={label} className="grid max-h-52 gap-0.5 overflow-y-auto rounded-lg border border-border p-1">
        <Option selected={!value} onSelect={() => choose(null)} name="No folder" />
        {listed.map((option) => (
          <Option key={option.id} selected={value === option.id} onSelect={() => choose(option)} name={option.name} detail={option.parentName ? `in ${option.parentName}` : undefined} />
        ))}
        {!loading && query.trim() && options.length === 0 ? <p className="px-2 py-1.5 text-[13px] text-muted">No folders match “{query.trim()}”.</p> : null}
        {options.length >= RESULT_LIMIT ? <p className="px-2 py-1.5 text-[12px] text-muted">Showing the first {RESULT_LIMIT}. Type more of the name to narrow it down.</p> : null}
      </div>
    </div>
  )
}

function Option({ selected, onSelect, name, detail }: { selected: boolean; onSelect: () => void; name: string; detail?: string }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected ? 'bg-selected text-text' : 'text-text hover:bg-hover',
      )}
    >
      <Folder className="h-4 w-4 shrink-0 text-folder" strokeWidth={1.5} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
      {detail ? <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted" title={detail}>{detail}</span> : null}
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" /> : null}
    </button>
  )
}
