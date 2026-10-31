import { MoreVertical } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { FolderVisual } from '@/components/drive/FolderVisual'
import type { FolderItem } from '@/types/drive'

const dropClasses = ['bg-accent-soft', 'border-accent']

export function FolderGrid({
  items,
  onFolderMenu,
  onFolderOpen,
  onDropItem,
}: {
  items: FolderItem[]
  onFolderMenu?: (event: MouseEvent<HTMLElement>, folder: FolderItem) => void
  onFolderOpen?: (folder: FolderItem) => void
  onDropItem?: (fileId: string, folderId: string) => void
}) {
  function onKeyDown(event: KeyboardEvent<HTMLElement>, folder: FolderItem) {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onFolderOpen?.(folder)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {items.map((folder) => (
        <div
          key={folder.id || folder.name}
          role="button"
          tabIndex={0}
          onClick={() => onFolderOpen?.(folder)}
          onKeyDown={(event) => onKeyDown(event, folder)}
          onContextMenu={(event) => onFolderMenu?.(event, folder)}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
          onDragEnter={(event) => event.currentTarget.classList.add(...dropClasses)}
          onDragLeave={(event) => event.currentTarget.classList.remove(...dropClasses)}
          onDrop={(event) => {
            event.preventDefault()
            event.currentTarget.classList.remove(...dropClasses)
            const fileId = event.dataTransfer.getData('text/plain')
            if (fileId && folder.id) onDropItem?.(fileId, folder.id)
          }}
          className="flex h-12 min-w-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-border bg-bg pl-3 pr-1.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <FolderVisual folder={folder} className="h-5 w-5" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={folder.name}>{folder.name}</span>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-selected hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={(event) => { event.stopPropagation(); onFolderMenu?.(event, folder) }}
            aria-label={`Open ${folder.name} menu`}
            aria-haspopup="menu"
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  )
}
