import { MoreVertical } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { FileIcon } from '@/components/drive/FileIcon'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { FileItem } from '@/types/drive'

export function FileGrid({
  files,
  selectedFileIds = new Set<string>(),
  detailsFileId = null,
  onSelectFile,
  onFileContextMenu,
  onToggleFile,
}: {
  files: FileItem[]
  selectedFileIds?: Set<string>
  detailsFileId?: string | null
  onSelectFile?: (file: FileItem) => void
  onFileContextMenu?: (event: MouseEvent<HTMLElement>, file: FileItem) => void
  onToggleFile?: (file: FileItem) => void
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
    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {files.map((file) => {
        const checked = selectedFileIds.has(file.id ?? '')
        const meta = file.accountLabel ? `${file.size} · ${file.accountLabel}` : file.size
        const selected = checked || (file.id != null && file.id === detailsFileId)
        return (
          <div
            key={file.id ?? file.name}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(event) => { event.dataTransfer.setData('text/plain', file.id ?? ''); event.dataTransfer.effectAllowed = 'move' }}
            onClick={() => onSelectFile?.(file)}
            onKeyDown={(event) => onKeyDown(event, file)}
            onContextMenu={(event) => onFileContextMenu?.(event, file)}
            className={cn(
              'group relative min-w-0 cursor-pointer rounded-[10px] border-[1.5px] bg-bg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              selected ? 'border-accent' : 'border-border hover:bg-hover',
            )}
          >
            <div className={cn('relative flex h-[120px] items-center justify-center rounded-md', selected ? 'bg-accent-soft' : 'bg-surface')}>
              <FileIcon kind={file.kind} className="h-8 w-8" />
              {onToggleFile ? (
                <span className={cn('absolute left-2 top-2 [@media(hover:none)]:opacity-100', anySelected || checked ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100')}>
                  <Checkbox checked={checked} onChange={() => onToggleFile(file)} aria-label={`Select ${file.name}`} />
                </span>
              ) : null}
              <button
                type="button"
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-selected hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={(event) => { event.stopPropagation(); onFileContextMenu?.(event, file) }}
                aria-label={`Open ${file.name} menu`}
                aria-haspopup="menu"
              >
                <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="min-w-0 px-1 pb-1 pt-2.5">
              <p className="truncate text-[13px] font-medium text-text" title={file.name}>{file.name}</p>
              <p className="mt-0.5 truncate text-[12px] tabular-nums text-muted" title={meta}>{meta}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
