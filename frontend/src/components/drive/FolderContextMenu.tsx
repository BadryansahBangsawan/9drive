import { Copy, Pencil, Scissors, Trash2, UserPlus } from 'lucide-react'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import type { FolderItem } from '@/types/drive'

const icon = { className: 'h-4 w-4', strokeWidth: 1.5 }

export function FolderContextMenu({
  x,
  y,
  folder,
  onClose,
  onCut,
  onRename,
  onInvite,
  onCopyLink,
  onDelete,
}: {
  x: number
  y: number
  folder: FolderItem | null
  onClose: () => void
  onCut: () => void
  onRename: () => void
  onInvite: () => void
  onCopyLink: () => void
  onDelete: () => void
}) {
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <Menu open={folder !== null} x={x} y={y} onClose={onClose}>
      {folder ? (
        <>
          <div className="max-w-[260px] truncate px-2 pb-1.5 pt-1 text-[11px] text-subtle" title={folder.name}>{folder.name}</div>
          <MenuItem icon={<Copy {...icon} />} onSelect={run(onCopyLink)}>Copy link</MenuItem>
          <MenuItem icon={<Scissors {...icon} />} shortcut="Ctrl X" onSelect={run(onCut)}>Cut</MenuItem>
          <MenuItem icon={<Pencil {...icon} />} onSelect={run(onRename)}>Rename</MenuItem>
          <MenuItem icon={<UserPlus {...icon} />} onSelect={run(onInvite)}>Invite member</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 {...icon} />} danger onSelect={run(onDelete)}>Delete folder</MenuItem>
        </>
      ) : null}
    </Menu>
  )
}
