import { createContext, useContext, useState, type ReactNode } from 'react'
import { API_URL, apiFetch, refreshAccessToken } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'

export type UploadProgressStatus = 'uploading' | 'done' | 'error' | 'partial'
export type UploadProgressFile = { name: string; size: number; percent: number; status: UploadProgressStatus; accountLabel?: string }
export type UploadProgressState = { open: boolean; fileName: string; percent: number; status: UploadProgressStatus; files: UploadProgressFile[] }

type ResumableSession = { sessionId: string; file: File; folderId?: string | null; targetAccountId?: string | null }

type UploadContextType = {
  uploadProgress: UploadProgressState
  setUploadProgress: React.Dispatch<React.SetStateAction<UploadProgressState>>
  uploadFiles: (files: File[], folderId: string | null, targetAccountId?: string | null) => Promise<void>
  retryFailedUpload: (fileName: string) => Promise<void>
}

const UploadContext = createContext<UploadContextType | undefined>(undefined)

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({
    open: false,
    fileName: '',
    percent: 0,
    status: 'uploading',
    files: []
  })
  const [resumableSessions, setResumableSessions] = useState<Record<string, ResumableSession>>({})

  function uploadSingleFileMultipart(file: File, folderId: string | null, accountId: string | null, onProgress: (percent: number) => void) {
    const attempt = () => new Promise<void>((resolve, reject) => {
      const form = new FormData()
      // Text fields go before the file so the server can read them while streaming.
      form.append('sizeBytes', String(file.size))
      form.append('fileName', file.name)
      form.append('mimeType', file.type || 'application/octet-stream')
      if (folderId) form.append('folderId', folderId)
      if (accountId) form.append('targetAccountId', accountId)
      form.append('file', file, file.name)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_URL}/uploads`)
      xhr.setRequestHeader('Authorization', `Bearer ${getAccessToken()}`)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100)
          resolve()
          return
        }
        let message = `Upload failed (${xhr.status})`
        try {
          const body = JSON.parse(xhr.responseText) as { message?: string; failed?: { message?: string }[] }
          message = body.failed?.[0]?.message || body.message || message
        } catch {
          // non-JSON error body; keep the status text
        }
        const error = new Error(message) as Error & { status?: number }
        error.status = xhr.status
        reject(error)
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.onabort = () => reject(new Error('Upload cancelled'))
      xhr.send(form)
    })

    return attempt().catch(async (error: Error & { status?: number }) => {
      // Expired access token: refresh once and retry the whole request.
      if (error.status === 401 && (await refreshAccessToken())) {
        onProgress(0)
        return attempt()
      }
      throw error
    })
  }

  async function uploadSingleFileResumable(file: File, folderId: string | null, onProgress: (percent: number) => void, sessionIdToRetry?: string, targetAccountId?: string | null, onAccountLabel?: (label: string) => void) {
    const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB chunks (must be multiple of 256KB for Google Drive)
    let sessionId = sessionIdToRetry || ''
    let startOffset = 0

    // Pre-save session parameters so that retry is functional even if the init API call fails
    setResumableSessions(prev => ({
      ...prev,
      [file.name]: { sessionId, file, folderId, targetAccountId }
    }))

    // 1. Initialize or get status
    if (!sessionId) {
      const initData = await apiFetch<{ sessionId?: string; provider: string; accountId?: string; accountLabel?: string }>('/uploads/resumable/init', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: String(file.size),
          folderId: folderId || undefined,
          targetAccountId: targetAccountId || undefined
        })
      })
      if (initData.accountLabel) onAccountLabel?.(initData.accountLabel)
      if (initData.provider === 's3') {
        // S3 has no resumable session: send the whole file as one multipart request.
        await uploadSingleFileMultipart(file, folderId, initData.accountId ?? targetAccountId ?? null, onProgress)
        return
      }
      if (!initData.sessionId) throw new Error('Upload session was not created')
      sessionId = initData.sessionId
      // Update session with the active sessionId
      setResumableSessions(prev => ({
        ...prev,
        [file.name]: { sessionId, file, folderId, targetAccountId }
      }))
    } else {
      const statusData = await apiFetch<{ status: string; offset: string }>(`/uploads/resumable/status/${sessionId}`)
      startOffset = Number(statusData.offset)
      if (statusData.status === 'completed') {
        onProgress(100)
        return
      }
    }

    // 2. Upload chunk by chunk
    while (startOffset < file.size) {
      const endOffset = Math.min(startOffset + CHUNK_SIZE, file.size)
      const chunk = file.slice(startOffset, endOffset)

      // We use raw fetch with authorization header for binary stream upload
      const response = await fetch(`${API_URL}/uploads/resumable/chunk/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getAccessToken()}`,
          'Content-Range': `bytes ${startOffset}-${endOffset - 1}/${file.size}`,
          'Content-Length': String(chunk.size)
        },
        body: chunk
      })

      if (!response.ok) {
        throw new Error('Chunk upload failed')
      }

      const resData = await response.json() as { status: string; offset?: string }
      if (resData.status === 'completed') {
        onProgress(100)
        break
      }

      startOffset = Number(resData.offset)
      const percent = Math.min(99, Math.round((startOffset / file.size) * 100))
      onProgress(percent)
    }
  }

  async function uploadFiles(filesToUpload: File[], targetFolderId: string | null, targetAccountId?: string | null) {
    if (filesToUpload.length === 0) return

    // Setup initial status
    setUploadProgress({
      open: true,
      fileName: filesToUpload.length === 1 ? filesToUpload[0].name : `${filesToUpload.length} files`,
      percent: 0,
      status: 'uploading',
      files: filesToUpload.map(f => ({ name: f.name, size: f.size, percent: 0, status: 'uploading' }))
    })

    // Upload files sequentially
    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i]
      try {
        await uploadSingleFileResumable(file, targetFolderId, (filePercent) => {
          setUploadProgress((current) => {
            const nextFiles = [...current.files]
            if (nextFiles[i]) {
              nextFiles[i] = { ...nextFiles[i], percent: filePercent, status: filePercent >= 100 ? 'done' : 'uploading' }
            }
            const overallPercent = Math.round(nextFiles.reduce((sum, f) => sum + f.percent, 0) / nextFiles.length)
            return {
              ...current,
              percent: overallPercent,
              files: nextFiles
            }
          })
        }, undefined, targetAccountId, (label) => {
          setUploadProgress((current) => {
            const nextFiles = [...current.files]
            if (nextFiles[i]) nextFiles[i] = { ...nextFiles[i], accountLabel: label }
            return { ...current, files: nextFiles }
          })
        })
      } catch (err) {
        console.error('File upload failed:', file.name, err)
        setUploadProgress((current) => {
          const nextFiles = [...current.files]
          if (nextFiles[i]) {
            nextFiles[i] = { ...nextFiles[i], status: 'error' }
          }
          return {
            ...current,
            status: 'partial',
            files: nextFiles
          }
        })
      }
    }

    // Dispatch global events so active pages reload their data
    window.dispatchEvent(new Event('9drive:storage-changed'))
    window.dispatchEvent(new Event('9drive:upload-completed'))
  }

  async function retryFailedUpload(fileName: string) {
    const session = resumableSessions[fileName]
    if (!session) return

    setUploadProgress((current) => {
      const nextFiles = current.files.map(f => f.name === fileName ? { ...f, status: 'uploading' as const } : f)
      return {
        ...current,
        status: 'uploading',
        files: nextFiles
      }
    })

    try {
      const fileIndex = uploadProgress.files.findIndex(f => f.name === fileName)
      await uploadSingleFileResumable(session.file, session.folderId || null, (filePercent) => {
        setUploadProgress((current) => {
          const nextFiles = [...current.files]
          if (nextFiles[fileIndex]) {
            nextFiles[fileIndex] = { ...nextFiles[fileIndex], percent: filePercent, status: filePercent >= 100 ? 'done' : 'uploading' }
          }
          const overallPercent = Math.round(nextFiles.reduce((sum, f) => sum + f.percent, 0) / nextFiles.length)
          const allDone = nextFiles.every(f => f.status === 'done')
          return {
            ...current,
            percent: overallPercent,
            status: allDone ? 'done' : 'uploading',
            files: nextFiles
          }
        })
      }, session.sessionId, session.targetAccountId)

      window.dispatchEvent(new Event('9drive:storage-changed'))
      window.dispatchEvent(new Event('9drive:upload-completed'))
    } catch (err) {
      console.error('Retry upload failed:', fileName, err)
      setUploadProgress((current) => {
        const nextFiles = current.files.map(f => f.name === fileName ? { ...f, status: 'error' as const } : f)
        return {
          ...current,
          status: 'partial',
          files: nextFiles
        }
      })
    }
  }

  return (
    <UploadContext.Provider value={{ uploadProgress, setUploadProgress, uploadFiles, retryFailedUpload }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload() {
  const context = useContext(UploadContext)
  if (context === undefined) {
    throw new Error('useUpload must be used within an UploadProvider')
  }
  return context
}
