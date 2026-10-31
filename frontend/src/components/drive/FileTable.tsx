import { MoreVertical } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { FileIcon } from '@/components/drive/FileIcon'
import { StoredIn } from '@/components/drive/StoredIn'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { FileItem } from '@/types/drive'

const headCell = 'h-9 px-3 text-left text-[12px] font-medium text-subtle'

export function FileTable({
  files,
  selectedFileIds = new Set<string>(),
  detailsFileId = null,
  allSelected = false,
  onSelectFile,
  onFileContextMenu,
  onToggleFile,
  onToggleAll,
}: {
  files: FileItem[]
  selectedFileIds?: Set<string>
  detailsFileId?: string | null
  allSelected?: boolean
  onSelectFile?: (file: FileItem) => void
  onFileContextMenu?: (event: MouseEvent<HTMLElement>, file: FileItem) => void
  onToggleFile?: (file: FileItem) => void
  onToggleAll?: () => void
}) {
  const anySelected = selectedFileIds.size > 0

  function onKeyDown(event: KeyboardEvent<HTMLElement>, file: FileItem) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectFile?.(file)
    }
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="hidden w-[220px] md:table-column" />
          <col className="w-[88px] sm:w-[104px]" />
          <col className="hidden w-[168px] md:table-column" />
          <col className="w-11" />
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="h-9 pl-3 text-left">
              {onToggleAll ? <Checkbox checked={allSelected} onChange={onToggleAll} aria-label="Select all files" /> : null}
            </th>
            <th className={headCell}>Name</th>
            <th className={cn(headCell, 'hidden md:table-cell')}>Stored in</th>
            <th className={cn(headCell, 'text-right')}>Size</th>
            <th className={cn(headCell, 'hidden md:table-cell')}>Modified</th>
            <th className="h-9">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const checked = selectedFileIds.has(file.id ?? '')
            const selected = checked || (file.id != null && file.id === detailsFileId)
            return (
              <tr
                key={file.id ?? file.name}
                tabIndex={0}
                draggable
                onDragStart={(event) => { event.dataTransfer.setData('text/plain', file.id ?? ''); event.dataTransfer.effectAllowed = 'move' }}
                onContextMenu={(event) => onFileContextMenu?.(event, file)}
                onClick={() => onSelectFile?.(file)}
                onKeyDown={(event) => onKeyDown(event, file)}
                aria-selected={selected}
                className={cn(
                  'group h-11 cursor-pointer border-b border-border last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  selected ? 'bg-accent-soft' : 'hover:bg-hover',
                )}
              >
                <td className="pl-3">
                  {onToggleFile ? (
                    <span className={cn('inline-flex [@media(hover:none)]:opacity-100', anySelected || checked ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100')}>
                      <Checkbox checked={checked} onChange={() => onToggleFile(file)} aria-label={`Select ${file.name}`} />
                    </span>
                  ) : null}
                </td>
                <td className="px-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FileIcon kind={file.kind} />
                    <span className="truncate font-medium text-text" title={file.name}>{file.name}</span>
                  </span>
                </td>
                <td className="hidden px-3 text-muted md:table-cell">
                  {file.accountLabel ? <StoredIn provider={file.accountProvider} label={file.accountLabel} /> : <span className="text-subtle">--</span>}
                </td>
                <td className="px-3 text-right tabular-nums text-muted">{file.size}</td>
                <td className="hidden px-3 tabular-nums text-muted md:table-cell">
                  <span className="block truncate" title={file.date}>{file.date}</span>
                </td>
                <td className="pr-2">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-selected hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={(event) => { event.stopPropagation(); onFileContextMenu?.(event, file) }}
                    aria-label={`Open ${file.name} menu`}
                    aria-haspopup="menu"
                  >
                    <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
