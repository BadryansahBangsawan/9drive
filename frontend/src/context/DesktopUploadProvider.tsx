import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { UploadContext, type UploadProgressFile, type UploadProgressState, type UploadProgressStatus } from '@/context/UploadContext'
import { listen, uploader, type NativeUpload } from '@/lib/desktop'

// Desktop uploads run in the native uploader (Rust): files stream from disk straight to Google Drive
// or S3, the queue survives restarts, and dropped connections resume on their own. This provider
// mirrors that queue into the same progress state the web upload panel uses.

function toProgressFile(item: NativeUpload): UploadProgressFile {
  const percent = item.size > 0 ? Math.min(100, Math.floor((item.uploaded / item.size) * 100)) : item.status === 'done' ? 100 : 0
  const statusMap: Record<NativeUpload['status'], UploadProgressStatus> = {
    queued: 'queued', uploading: 'uploading', waiting: 'uploading', paused: 'paused', done: 'done', error: 'error', cancelled: 'error',
  }
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    percent: item.status === 'done' ? 100 : Math.min(99, percent),
    status: statusMap[item.status],
    accountLabel: item.accountLabel ?? undefined,
    error: item.status === 'cancelled' ? 'Cancelled' : item.error ?? undefined,
    detail: item.status === 'waiting' ? (item.error ? `Waiting to retry · ${item.error}` : 'Waiting for the connection') : undefined,
  }
}

function overallStatus(files: UploadProgressFile[]): UploadProgressStatus {
  if (files.some((f) => f.status === 'uploading' || f.status === 'queued')) return 'uploading'
  if (files.some((f) => f.status === 'error')) return 'partial'
  if (files.some((f) => f.status === 'paused')) return 'paused'
  return 'done'
}

export function DesktopUploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Map<string, NativeUpload>>(new Map())
  const [open, setOpen] = useState(false)
  const statuses = useRef(new Map<string, NativeUpload['status']>())

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    const apply = (item: NativeUpload) => {
      const before = statuses.current.get(item.id)
      statuses.current.set(item.id, item.status)
      if (item.status === 'done' && before && before !== 'done') {
        window.dispatchEvent(new Event('9drive:storage-changed'))
        window.dispatchEvent(new Event('9drive:upload-completed'))
      }
      setItems((current) => new Map(current).set(item.id, item))
    }
    listen<NativeUpload>('upload://changed', apply).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    // Uploads left from the last session resume on their own; show them.
    uploader.list().then((list) => {
      if (disposed) return
      for (const item of list) statuses.current.set(item.id, item.status)
      setItems(new Map(list.map((item) => [item.id, item])))
      if (list.some((item) => item.status !== 'done' && item.status !== 'cancelled')) setOpen(true)
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const uploadProgress = useMemo<UploadProgressState>(() => {
    const files = [...items.values()].map(toProgressFile)
    const percent = files.length ? Math.round(files.reduce((sum, f) => sum + f.percent, 0) / files.length) : 0
    return { open: open && files.length > 0, fileName: files.length === 1 ? files[0].name : `${files.length} files`, percent, status: overallStatus(files), files }
  }, [items, open])

  // The panel only ever closes itself; closing also clears finished uploads from the queue.
  function setUploadProgress(action: SetStateAction<UploadProgressState>) {
    const next = typeof action === 'function' ? action(uploadProgress) : action
    if (!next.open) {
      setOpen(false)
      uploader.clearFinished().then((list) => setItems(new Map(list.map((item) => [item.id, item])))).catch(() => undefined)
    }
  }

  async function uploadPaths(paths: string[], folderId: string | null, targetAccountId?: string | null) {
    if (paths.length === 0) return
    const added = await uploader.enqueue(paths, folderId, targetAccountId ?? null)
    setItems((current) => {
      const next = new Map(current)
      for (const item of added) next.set(item.id, item)
      return next
    })
    for (const item of added) statuses.current.set(item.id, item.status)
    setOpen(true)
  }

  return (
    <UploadContext.Provider
      value={{
        uploadProgress,
        setUploadProgress,
        uploadFiles: async () => { throw new Error('The desktop app uploads files by path.') },
        uploadPaths,
        retryFailedUpload: (id) => uploader.resume(id),
        pauseUpload: (id) => uploader.pause(id),
        resumeUpload: (id) => uploader.resume(id),
        cancelUpload: (id) => uploader.cancel(id),
      }}
    >
      {children}
    </UploadContext.Provider>
  )
}
