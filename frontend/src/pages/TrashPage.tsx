import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { FileIcon } from '@/components/drive/FileIcon'
import { PageHeader } from '@/components/drive/PageHeader'
import { SelectionBar } from '@/components/drive/SelectionBar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'
import { apiFetch, formatBytes } from '@/lib/api'

type TrashFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: string
  deletedAt: string
  folder: { id: string; name: string } | null
}

function kindOf(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image' as const
  if (mimeType.startsWith('video/')) return 'video' as const
  if (mimeType.includes('pdf')) return 'pdf' as const
  return 'doc' as const
}

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })

export function TrashPage() {
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [files, setFiles] = useState<TrashFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null)

  async function loadTrash() {
    try {
      const data = await apiFetch<{ files: TrashFile[] }>('/files/trash')
      setFiles(data.files)
    } catch (error) {
      report(error instanceof Error ? error.message : 'Failed to load trash', true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setBreadcrumb([{ label: 'Trash' }])
    setHeaderActions(null)
    loadTrash()
  }, [])

  function report(text: string, error: boolean) {
    setMessage(text)
    setIsError(error)
  }

  function removeLocal(ids: string[]) {
    setFiles((prev) => prev.filter((f) => !ids.includes(f.id)))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
    window.dispatchEvent(new Event('9drive:storage-changed'))
  }

  async function handleRestore(ids: string[]) {
    if (ids.length === 0) return
    setBusy(true)
    setMessage('')
    try {
      await apiFetch('/files/batch/restore', { method: 'POST', body: JSON.stringify({ fileIds: ids }) })
      removeLocal(ids)
      report(`Restored ${ids.length} ${ids.length === 1 ? 'file' : 'files'}.`, false)
    } catch (error) {
      report(error instanceof Error ? error.message : 'Failed to restore files', true)
    } finally {
      setBusy(false)
    }
  }

  async function handlePermanentDelete(ids: string[]) {
    setConfirmIds(null)
    if (ids.length === 0) return
    setBusy(true)
    setMessage('')
    try {
      const result = await apiFetch<{ deleted: number; failed: { fileId: string; message: string }[] }>('/files/batch/permanent', {
        method: 'DELETE',
        body: JSON.stringify({ fileIds: ids }),
      })
      const failedIds = new Set((result.failed ?? []).map((f) => f.fileId))
      removeLocal(ids.filter((id) => !failedIds.has(id)))
      if (failedIds.size > 0) {
        report(`Deleted ${result.deleted}, but ${failedIds.size} could not be deleted: ${result.failed[0].message}`, true)
      } else {
        report(`Permanently deleted ${result.deleted} ${result.deleted === 1 ? 'file' : 'files'}.`, false)
      }
    } catch (error) {
      report(error instanceof Error ? error.message : 'Failed to permanently delete files', true)
    } finally {
      setBusy(false)
    }
  }

  const allSelected = files.length > 0 && selectedIds.size === files.length
  const selected = useMemo(() => Array.from(selectedIds), [selectedIds])

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <PageHeader
        title="Trash"
        description="Deleted files stay here until you restore or delete them permanently."
        actions={
          files.length > 0 ? (
            <Button variant="dangerOutline" onClick={() => setConfirmIds(files.map((f) => f.id))} disabled={busy}>
              <Trash2 className="h-4 w-4" strokeWidth={1.5} /> Empty trash
            </Button>
          ) : null
        }
      />

      {message ? (
        <p role={isError ? 'alert' : 'status'} className={`mt-4 rounded-[10px] border px-3 py-2 text-[13px] ${isError ? 'border-danger text-danger' : 'border-border bg-surface text-text'}`}>
          {message}
        </p>
      ) : null}

      {selected.length > 0 ? (
        <div className="mt-4">
          <SelectionBar count={selected.length}>
            <Button variant="secondary" size="sm" onClick={() => handleRestore(selected)} disabled={busy}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.5} /> Restore
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmIds(selected)} disabled={busy}>
              <Trash2 className="h-4 w-4" strokeWidth={1.5} /> Delete permanently
            </Button>
          </SelectionBar>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-10 text-center text-[13px] text-muted">Loading trash…</p>
      ) : files.length === 0 ? (
        <EmptyState icon={<Trash2 className="h-4 w-4" strokeWidth={1.5} />} title="Trash is empty" description="Deleted files will appear here." />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="h-9 border-b border-border text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">
                <th className="w-10 px-2 font-medium">
                  <Checkbox checked={allSelected} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(files.map((f) => f.id)))} aria-label="Select all" />
                </th>
                <th className="px-2 font-medium">Name</th>
                <th className="hidden px-2 font-medium md:table-cell">Original location</th>
                <th className="w-24 px-2 text-right font-medium">Size</th>
                <th className="w-32 px-2 text-right font-medium">Deleted</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="h-12 border-b border-border hover:bg-hover">
                  <td className="px-2">
                    <Checkbox checked={selectedIds.has(file.id)} onChange={() => toggle(file.id)} aria-label={`Select ${file.name}`} />
                  </td>
                  <td className="max-w-0 px-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FileIcon kind={kindOf(file.mimeType)} />
                      <span className="truncate text-[13px] font-medium text-text" title={file.name}>{file.name}</span>
                    </div>
                  </td>
                  <td className="hidden max-w-[14rem] truncate px-2 text-[13px] text-muted md:table-cell" title={file.folder?.name ?? 'All files'}>{file.folder?.name ?? 'All files'}</td>
                  <td className="px-2 text-right text-[13px] tabular-nums text-muted">{formatBytes(file.sizeBytes)}</td>
                  <td className="px-2 text-right text-[13px] tabular-nums text-muted">{dateFmt.format(new Date(file.deletedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={confirmIds !== null}
        onClose={() => setConfirmIds(null)}
        title={confirmIds && confirmIds.length === files.length && selected.length !== files.length ? 'Empty trash?' : 'Delete permanently?'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmIds(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => confirmIds && handlePermanentDelete(confirmIds)}>Delete permanently</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          {confirmIds?.length ?? 0} {confirmIds?.length === 1 ? 'file' : 'files'} will be deleted for good. This can't be undone.
        </p>
      </Dialog>
    </>
  )
}
