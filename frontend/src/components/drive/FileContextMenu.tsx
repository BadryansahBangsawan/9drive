import { Download, Eye, FolderInput, Info, Link2, Pencil, Trash2 } from 'lucide-react'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import type { FileItem } from '@/types/drive'

const icon = { className: 'h-4 w-4', strokeWidth: 1.5 }

export function FileContextMenu({
  x,
  y,
  file,
  showDetails = false,
  onClose,
  onView,
  onDownload,
  onRename,
  onMove,
  onDetails,
  onShare,
  onDelete,
}: {
  x: number
  y: number
  file: FileItem | null
  /** Below 1024px the details panel is not docked; the menu offers it instead. */
  showDetails?: boolean
  onClose: () => void
  onView: () => void
  onDownload: () => void
  onRename: () => void
  onMove: () => void
  onDetails: () => void
  onShare: () => void
  onDelete: () => void
}) {
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <Menu open={file !== null} x={x} y={y} onClose={onClose}>
      {file ? (
        <>
          <div className="max-w-[260px] truncate px-2 pb-1.5 pt-1 text-[11px] text-subtle" title={file.name}>{file.name}</div>
          <MenuItem icon={<Eye {...icon} />} onSelect={run(onView)}>Preview</MenuItem>
          {showDetails ? <MenuItem icon={<Info {...icon} />} onSelect={run(onDetails)}>Details</MenuItem> : null}
          <MenuItem icon={<Download {...icon} />} onSelect={run(onDownload)}>Download</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Link2 {...icon} />} onSelect={run(onShare)}>Share…</MenuItem>
          <MenuItem icon={<Pencil {...icon} />} onSelect={run(onRename)}>Rename</MenuItem>
          <MenuItem icon={<FolderInput {...icon} />} onSelect={run(onMove)}>Move to…</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 {...icon} />} danger onSelect={run(onDelete)}>Move to Trash</MenuItem>
        </>
      ) : null}
    </Menu>
  )
}
