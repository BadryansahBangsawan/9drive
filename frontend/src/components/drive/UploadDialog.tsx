import { useEffect, useState, type DragEvent, type FormEvent } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { apiFetch, formatBytes } from '@/lib/api'
import { accountLabel, type ConnectedAccount } from '@/lib/accounts'
import { cn } from '@/lib/utils'
import { useUpload } from '@/context/UploadContext'

const selectClass = 'h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-text outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25'
const fieldLabelClass = 'grid gap-1.5 text-[13px] font-medium text-text'

export function UploadDialog({ open, onClose, folderId }: { open: boolean; onClose: () => void; folderId: string | null }) {
  const { uploadFiles } = useUpload()
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([])
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [targetFolderId, setTargetFolderId] = useState('')
  const [targetAccountId, setTargetAccountId] = useState('')

  useEffect(() => {
    if (!open) return
    setFiles([])
    setDragging(false)
    setTargetFolderId(folderId ?? '')
    setTargetAccountId('')
    let cancelled = false
    Promise.all([
      apiFetch<{ folders: { id: string; name: string }[] }>('/folders?all=1'),
      apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts'),
    ])
      .then(([folderData, accountData]) => {
        if (cancelled) return
        setFolders(folderData.folders)
        setAccounts(accountData.accounts ?? [])
      })
      .catch((error) => console.error('Failed to load upload destinations', error))
    return () => {
      cancelled = true
    }
  }, [open, folderId])

  function pick(list: FileList | File[] | null | undefined) {
    const next = Array.from(list ?? [])
    if (next.length > 0) setFiles(next)
  }

  function onDrag(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') setDragging(true)
    if (event.type === 'dragleave' || event.type === 'drop') setDragging(false)
    if (event.type === 'drop') pick(event.dataTransfer.files)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (files.length === 0) return
    const queued = [...files]
    onClose()
    uploadFiles(queued, targetFolderId || null, targetAccountId || null).catch((error) => console.error('Upload failed', error))
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Upload files"
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="upload-dialog-form" disabled={files.length === 0}>
            {files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
          </Button>
        </>
      }
    >
      <form id="upload-dialog-form" onSubmit={submit} className="grid gap-4">
        <label
          onDragEnter={onDrag}
          onDragOver={onDrag}
          onDragLeave={onDrag}
          onDrop={onDrag}
          className={cn(
            'grid cursor-pointer gap-2 rounded-[10px] border-2 border-dashed p-5 text-center transition-colors focus-within:ring-2 focus-within:ring-accent',
            dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:border-accent',
          )}
        >
          <Upload className={cn('mx-auto h-6 w-6', dragging ? 'text-accent' : 'text-muted')} strokeWidth={1.5} aria-hidden="true" />
          <span className="text-[13px] font-medium text-text">Drop files here or click to browse</span>
          <input type="file" multiple className="sr-only" onChange={(event) => pick(event.target.files)} />
        </label>

        {files.length > 0 ? (
          <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-1.5 text-[13px]">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-text" title={file.name}>{file.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-muted">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  className="shrink-0 rounded-md text-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label className={fieldLabelClass}>
          Destination folder
          <select className={selectClass} value={targetFolderId} onChange={(event) => setTargetFolderId(event.target.value)}>
            <option value="">No folder</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <label className={fieldLabelClass}>
          Destination account
          <select className={selectClass} value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)}>
            <option value="">Automatic (routing rule)</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
        </label>
      </form>
    </Dialog>
  )
}
