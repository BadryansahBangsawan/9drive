// Stand-in for lib/desktop.ts in web builds (vite.config.ts aliases it), so no Tauri code ships to
// browsers. Callers check `isDesktop` before using any of this.
import type * as Desktop from './desktop'

export type { DownloadEvent, NativeUpload, NativeUploadStatus, PickedFile } from './desktop'

const unavailable = () => Promise.reject(new Error('Only available in the desktop app.'))

export const invoke = unavailable as typeof Desktop.invoke
export const listen = unavailable as typeof Desktop.listen
export const uploader: typeof Desktop.uploader = {
  configure: unavailable, enqueue: unavailable, list: unavailable, pause: unavailable, resume: unavailable, cancel: unavailable, clearFinished: unavailable,
}
export const serverInfo = unavailable as typeof Desktop.serverInfo
export const inspectPaths = unavailable as typeof Desktop.inspectPaths
export const pickFiles = unavailable as typeof Desktop.pickFiles
export const onFileDrop = unavailable as typeof Desktop.onFileDrop
export const openExternal = unavailable as typeof Desktop.openExternal
export const chooseSavePath = unavailable as typeof Desktop.chooseSavePath
export const downloadToFile = unavailable as typeof Desktop.downloadToFile
export const onDeepLink = unavailable as typeof Desktop.onDeepLink
export const ask = unavailable as typeof Desktop.ask
export const offerUpdate = unavailable as typeof Desktop.offerUpdate
