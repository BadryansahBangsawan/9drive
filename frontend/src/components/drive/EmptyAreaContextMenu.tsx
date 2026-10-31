import { ClipboardPaste, FolderPlus, Upload } from 'lucide-react'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'

const icon = { className: 'h-4 w-4', strokeWidth: 1.5 }

export function EmptyAreaContextMenu({
  x,
  y,
  open,
  canPasteFolder = false,
  onClose,
  onUpload,
  onCreateFolder,
  onPasteFolder,
}: {
  x: number
  y: number
  open: boolean
  canPasteFolder?: boolean
  onClose: () => void
  onUpload: () => void
  onCreateFolder: () => void
  onPasteFolder?: () => void
}) {
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <Menu open={open} x={x} y={y} onClose={onClose}>
      <MenuItem icon={<Upload {...icon} />} onSelect={run(onUpload)}>Upload file</MenuItem>
      <MenuItem icon={<FolderPlus {...icon} />} onSelect={run(onCreateFolder)}>New folder</MenuItem>
      {canPasteFolder && onPasteFolder ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<ClipboardPaste {...icon} />} onSelect={run(onPasteFolder)}>Paste folder here</MenuItem>
        </>
      ) : null}
    </Menu>
  )
}
