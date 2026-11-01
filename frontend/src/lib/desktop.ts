// Bridge to the desktop app's native side (Tauri). Every Tauri module is imported lazily, and callers
// check `isDesktop` first, so web builds never load (or bundle) any of it.
import type { UnlistenFn } from '@tauri-apps/api/event'

export type NativeUploadStatus = 'queued' | 'uploading' | 'waiting' | 'paused' | 'done' | 'error' | 'cancelled'
export type NativeUpload = {
  id: string
  name: string
  size: number
  uploaded: number
  status: NativeUploadStatus
  error?: string | null
  accountLabel?: string | null
}
export type PickedFile = { path: string; name: string; size: number }
export type DownloadEvent = { id: string; received: number; total: number | null; status: 'downloading' | 'done' | 'error' | 'cancelled'; error?: string | null }

export async function invoke<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, (e) => handler(e.payload))
}

export const uploader = {
  configure: (auth: { apiUrl: string; accessToken: string | null; refreshToken: string | null }) => invoke<void>('uploader_configure', { auth }),
  enqueue: (paths: string[], folderId: string | null, targetAccountId: string | null) =>
    invoke<NativeUpload[]>('uploader_enqueue', { request: { paths, folderId, targetAccountId } }),
  list: () => invoke<NativeUpload[]>('uploader_list'),
  pause: (id: string) => invoke<void>('uploader_pause', { id }),
  resume: (id: string) => invoke<void>('uploader_resume', { id }),
  cancel: (id: string) => invoke<void>('uploader_cancel', { id }),
  clearFinished: () => invoke<NativeUpload[]>('uploader_clear_finished'),
}

// Names and sizes of local files; folders and unreadable paths are left out.
export function inspectPaths(paths: string[]) {
  return invoke<PickedFile[]>('inspect_paths', { paths })
}

export async function pickFiles(): Promise<PickedFile[]> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ multiple: true, directory: false, title: 'Choose files to upload' })
  if (!selected) return []
  return inspectPaths(Array.isArray(selected) ? selected : [selected])
}

// Files dragged in from Finder/Explorer. (Tauri hands over paths, not browser File objects.)
export async function onFileDrop(onDrop: (paths: string[]) => void, onHover: (hovering: boolean) => void): Promise<UnlistenFn> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload
    if (payload.type === 'enter' || payload.type === 'over') onHover(true)
    else if (payload.type === 'leave') onHover(false)
    else if (payload.type === 'drop') {
      onHover(false)
      onDrop(payload.paths)
    }
  })
}

export async function openExternal(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

export async function chooseSavePath(defaultName: string) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath: defaultName, title: 'Save as' })
}

// Streams an API response (GET, or POST with a JSON body) to a file on disk. Resolves when it's saved.
export async function downloadToFile(request: { path: string; dest: string; method?: 'GET' | 'POST'; body?: unknown }, onProgress?: (event: DownloadEvent) => void) {
  const id = crypto.randomUUID()
  let unlisten: UnlistenFn | undefined
  const finished = new Promise<void>((resolve, reject) => {
    listen<DownloadEvent>('download://changed', (event) => {
      if (event.id !== id) return
      onProgress?.(event)
      if (event.status === 'done') resolve()
      else if (event.status === 'error' || event.status === 'cancelled') reject(new Error(event.error || 'Download failed'))
    }).then((fn) => { unlisten = fn })
  })
  try {
    await invoke<void>('download_start', { request: { id, ...request, method: request.method ?? 'GET' } })
    await finished
  } finally {
    unlisten?.()
  }
}

export async function onDeepLink(handler: (urls: string[]) => void): Promise<UnlistenFn> {
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
  const initial = await getCurrent().catch(() => null)
  if (initial?.length) handler(initial)
  return onOpenUrl(handler)
}

export async function ask(message: string, options: { title: string; okLabel: string; cancelLabel: string }) {
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(message, { ...options, kind: 'warning' })
}

// Offers an update from GitHub Releases, if there is one, and restarts into it.
export async function offerUpdate() {
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return
  const { ask } = await import('@tauri-apps/plugin-dialog')
  const install = await ask(`9Drive ${update.version} is available. You have ${update.currentVersion}.`, { title: 'Update available', okLabel: 'Install and restart', cancelLabel: 'Later' })
  if (!install) return
  await update.downloadAndInstall()
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}
