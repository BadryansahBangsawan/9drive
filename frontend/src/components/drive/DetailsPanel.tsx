import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { FileIcon } from '@/components/drive/FileIcon'
import { StoredIn } from '@/components/drive/StoredIn'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { FileItem } from '@/types/drive'

const kindLabels: Record<FileItem['kind'], string> = { image: 'Image', video: 'Video', pdf: 'PDF', doc: 'Document' }

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-[76px] shrink-0 text-[12px] text-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] text-text">{children}</dd>
    </div>
  )
}

function Truncated({ text }: { text: string }) {
  return <span className="block truncate" title={text}>{text}</span>
}

/**
 * Details for one file. Docked (320px, with its own header) on wide screens;
 * `embedded` drops the frame and header so the same content can sit inside a bottom-sheet Dialog.
 */
export function DetailsPanel({
  file,
  folderName,
  sharing,
  onClose,
  onCopyLink,
  onDownload,
  onMakeDrivePublic,
  embedded = false,
}: {
  file: FileItem
  folderName?: string | null
  sharing?: string
  onClose?: () => void
  onCopyLink: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  onMakeDrivePublic?: () => void | Promise<void>
  embedded?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const canMakePublic = Boolean(onMakeDrivePublic) && file.accountProvider === 'google_drive'

  async function copy() {
    try {
      await onCopyLink()
    } catch {
      return // the caller reports the failure
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function makePublic() {
    setPublishing(true)
    try {
      await onMakeDrivePublic?.()
    } finally {
      setPublishing(false)
      setConfirmOpen(false)
    }
  }

  const body = (
    <div className="grid min-w-0 gap-4 p-4">
      <div className="flex h-40 items-center justify-center rounded-lg bg-surface" aria-hidden="true">
        <FileIcon kind={file.kind} className="h-10 w-10" />
      </div>
      <div className="min-w-0">
        <h3 className="line-clamp-3 break-words text-[15px] font-semibold leading-snug text-text" title={file.name}>{file.name}</h3>
        <p className="mt-1 text-[12px] tabular-nums text-muted">{kindLabels[file.kind]} · {file.size}</p>
      </div>
      <dl className="grid gap-2.5 border-t border-border pt-4">
        <InfoRow label="Stored in">
          {file.accountLabel ? <StoredIn provider={file.accountProvider} label={file.accountLabel} /> : <span className="text-muted">--</span>}
        </InfoRow>
        <InfoRow label="Account"><Truncated text={file.accountEmail ?? '--'} /></InfoRow>
        <InfoRow label="Folder"><Truncated text={folderName || 'All files'} /></InfoRow>
        <InfoRow label="Modified"><span className="tabular-nums"><Truncated text={file.date} /></span></InfoRow>
        {sharing ? <InfoRow label="Sharing"><Truncated text={sharing} /></InfoRow> : null}
      </dl>
      <div className="grid gap-2">
        <Button variant="primary" className="w-full" onClick={copy}>{copied ? 'Link copied' : 'Copy share link'}</Button>
        <Button variant="secondary" className="w-full" onClick={() => void onDownload()}>Download</Button>
        {canMakePublic ? <Button variant="ghost" className="w-full" onClick={() => setConfirmOpen(true)}>Make public on Google Drive</Button> : null}
      </div>
      <Dialog
        open={confirmOpen}
        onClose={() => (publishing ? undefined : setConfirmOpen(false))}
        title="Make public on Google Drive?"
        width={420}
        footer={
          <>
            <Button variant="secondary" size="lg" disabled={publishing} onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button size="lg" disabled={publishing} onClick={makePublic}>{publishing ? 'Making public...' : 'Make public'}</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          Anyone with the Google Drive link will be able to view this file. This changes the file's permissions in Google Drive itself, not just in 9Drive. The link is copied to your clipboard.
        </p>
      </Dialog>
    </div>
  )

  if (embedded) return body

  return (
    <aside aria-label="File details" className="w-[320px] rounded-[10px] border border-border bg-bg">
      <div className="flex h-12 items-center justify-between border-b border-border pl-4 pr-2">
        <h2 className="text-[14px] font-semibold text-text">Details</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close details" onClick={onClose}>
          <X className="h-4 w-4" strokeWidth={1.5} />
        </Button>
      </div>
      {body}
    </aside>
  )
}
