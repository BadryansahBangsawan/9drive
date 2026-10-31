import { useState } from 'react'
import { Check, ChevronDown, File as FileIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/api'
import { useUpload } from '@/context/UploadContext'
import { cn } from '@/lib/utils'

export function UploadPanel() {
  const { uploadProgress, setUploadProgress, retryFailedUpload } = useUpload()
  const [collapsed, setCollapsed] = useState(false)
  if (!uploadProgress.open) return null

  const { files } = uploadProgress
  const total = files.length
  const doneCount = files.filter((f) => f.status === 'done').length
  const uploading = files.some((f) => f.status === 'uploading')
  const failed = files.some((f) => f.status === 'error')
  const title = uploading
    ? `Uploading ${Math.min(total, doneCount + 1)} of ${total}`
    : failed
      ? 'Some uploads failed'
      : 'Upload complete'

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-[70] overflow-hidden rounded-xl border border-border bg-bg shadow-[0_12px_32px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[360px]"
    >
      <div className="flex h-11 items-center justify-between border-b border-border pl-4 pr-2">
        <span className={cn('text-[13px] font-medium', !uploading && failed ? 'text-danger' : 'text-text')}>{title}</span>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" aria-label={collapsed ? 'Expand uploads' : 'Collapse uploads'} onClick={() => setCollapsed(!collapsed)}>
            <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} strokeWidth={1.5} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close uploads" onClick={() => setUploadProgress((c) => ({ ...c, open: false }))}>
            <X className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>
      </div>
      {!collapsed && (
        <ul className="max-h-[50dvh] overflow-y-auto">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileIcon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-text" title={file.name}>{file.name}</p>
                {file.status === 'queued' ? (
                  <p className="truncate text-xs tabular-nums text-muted">{formatBytes(file.size)} · Waiting</p>
                ) : file.status === 'uploading' ? (
                  <>
                    <p className="truncate text-xs tabular-nums text-muted">
                      {formatBytes(file.size)}{file.accountLabel ? ` · to ${file.accountLabel}` : ''}
                    </p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hover">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${file.percent}%` }} />
                    </div>
                  </>
                ) : file.status === 'error' ? (
                  <p className="truncate text-xs text-danger" title={file.error}>{file.error ? `Failed · ${file.error}` : 'Failed'}</p>
                ) : (
                  <p className="truncate text-xs tabular-nums text-muted">{formatBytes(file.size)}</p>
                )}
              </div>
              {file.status === 'done' && <Check className="h-4 w-4 shrink-0 text-drive" strokeWidth={1.5} aria-label="Done" />}
              {file.status === 'error' && (
                <Button variant="secondary" size="sm" onClick={() => retryFailedUpload(file.id)}>Retry</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
