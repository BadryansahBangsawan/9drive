import { google, type drive_v3 } from './google-apis.js'
import type { ConnectedAccount, Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { accountLabel } from '../../utils/account-label.js'
import { googleDownloadExportMimeTypes } from '../files/stream-google-file.js'
import { defaultFolderColor, defaultFolderIconUrl, type FolderSource } from '../folders/folder-defaults.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, googleDriveFolderMimeType as FOLDER_MIME, syncGoogleQuota } from './google.service.js'

// Imports everything a connected Google account owns in My Drive into 9drive:
// - the `9drive` app folder is the app root (where 9drive uploads go); its subfolders are app folders;
// - the rest of My Drive appears under one folder per account (source 'drive_root', standing for
//   My Drive itself), with Drive's folder tree mirrored as folders with source 'drive'.
//
// Drive is the source of truth for names and placement, with three exceptions:
// - a placement Drive can't represent (parent folder bound to another account, or without a Drive
//   mirror) is app-side only and is kept;
// - rows edited in 9drive while a sync runs (updatedAt >= the sync's start) are left alone;
// - anything the user deleted in 9drive stays out until they restore it. Rows sync itself deleted
//   because they left Drive (deletedBySync) come back when they reappear.
//
// A full import lists the whole My Drive. After that, incremental syncs read the Drive changes feed
// from the stored token; a full import still runs at least daily, and whenever the token is missing
// or rejected.

const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.'
const CREATE_BATCH = 500
const SWEEP_BATCH = 2000
const FULL_SYNC_EVERY_MS = 24 * 60 * 60_000
const HIDDEN = Symbol('hidden')
type Placement = string | null | typeof HIDDEN

export type GoogleDriveSyncResult = { accountId: string; mode: 'full' | 'incremental'; created: number; updated: number; deleted: number }

// Only the columns sync reads: a My Drive can hold hundreds of thousands of rows, so full rows
// (and full result sets) are never loaded at once.
const folderSelect = { id: true, parentId: true, connectedAccountId: true, providerFolderId: true, source: true, name: true, deletedAt: true, deletedBySync: true, updatedAt: true } as const
type FolderRow = Prisma.FolderGetPayload<{ select: typeof folderSelect }>
const fileSelect = { id: true, providerFileId: true, name: true, mimeType: true, sizeBytes: true, status: true, deletedAt: true, deletedBySync: true, folderId: true, updatedAt: true } as const
type FileRow = Prisma.FileGetPayload<{ select: typeof fileSelect }>

type DriveItem = { id: string; name: string; mimeType: string; size?: string | null; parents?: string[] | null; createdTime?: string | null }

// Shortcuts and Google-native types we can't download or export (Forms, Sites, ...) are skipped.
function isImportable(mimeType: string) {
  return !mimeType.startsWith(GOOGLE_APPS_PREFIX) || mimeType in googleDownloadExportMimeTypes
}

// Yields a Drive listing one page (up to 1,000 items) at a time.
async function* listPages(drive: drive_v3.Drive, q: string, fields: string) {
  let pageToken: string | undefined
  do {
    const response = await drive.files.list({ q, spaces: 'drive', fields: `nextPageToken,files(${fields})`, pageSize: 1000, pageToken })
    yield response.data.files ?? []
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)
}

async function ensureAccountRootFolder(account: ConnectedAccount, myDriveId: string) {
  const name = accountLabel(account)
  const existing = await prisma.folder.findFirst({ where: { userId: account.userId, connectedAccountId: account.id, source: 'drive_root' } })
  if (!existing) {
    return prisma.folder.create({
      data: { userId: account.userId, connectedAccountId: account.id, provider: 'google_drive', providerFolderId: myDriveId, source: 'drive_root', name, parentId: null, color: defaultFolderColor, iconUrl: defaultFolderIconUrl },
    })
  }
  if (existing.deletedAt || existing.parentId || existing.name !== name || existing.providerFolderId !== myDriveId) {
    return prisma.folder.update({ where: { id: existing.id }, data: { deletedAt: null, deletedBySync: false, parentId: null, name, providerFolderId: myDriveId } })
  }
  return existing
}

// Everything one sync run needs to place Drive items, plus its counters.
class Reconciler {
  created = 0
  updated = 0
  deleted = 0
  readonly startedAt = new Date()
  appFolderId = ''
  myDriveId = ''
  accountRoot!: FolderRow
  // This account's folder rows by Drive folder id, and every folder of the user by row id.
  rowByDriveId = new Map<string, FolderRow>()
  folderById = new Map<string, FolderRow>()

  constructor(readonly account: ConnectedAccount, readonly drive: drive_v3.Drive) {}

  get userId() { return this.account.userId }

  async load(myDriveId?: string) {
    this.appFolderId = await ensureGoogleAppFolder(this.account)
    this.myDriveId = myDriveId ?? (await this.drive.files.get({ fileId: 'root', fields: 'id' })).data.id ?? ''
    if (!this.myDriveId) throw new Error('Google Drive did not return the My Drive folder id.')
    this.accountRoot = await ensureAccountRootFolder(this.account, this.myDriveId)
    const folders = await prisma.folder.findMany({ where: { userId: this.userId }, select: folderSelect })
    this.folderById = new Map(folders.map((f) => [f.id, f]))
    this.rowByDriveId = new Map(folders.filter((f) => f.connectedAccountId === this.account.id && f.providerFolderId).map((f) => [f.providerFolderId!, f]))
  }

  editedDuringSync(row: { updatedAt: Date }) {
    return row.updatedAt >= this.startedAt
  }

  // A parent Drive can't represent: bound to another account, or without a Drive mirror.
  keepsAppParent(folderId: string | null) {
    if (!folderId) return false
    const folder = this.folderById.get(folderId)
    return !!folder && !folder.deletedAt && (folder.connectedAccountId !== this.account.id || !folder.providerFolderId)
  }

  // Where children of a Drive folder go in 9drive, or undefined when that folder isn't known (yet).
  placementOfDriveFolder(driveFolderId: string | null | undefined): { place: Placement; inApp: boolean } | undefined {
    if (!driveFolderId || driveFolderId === this.myDriveId) return { place: this.accountRoot.id, inApp: false }
    if (driveFolderId === this.appFolderId) return { place: null, inApp: true }
    const row = this.rowByDriveId.get(driveFolderId)
    if (!row) return undefined
    if (row.deletedAt) return row.deletedBySync ? undefined : { place: HIDDEN, inApp: row.source === 'app' }
    return { place: row.id, inApp: row.source === 'app' }
  }

  // Creates or updates the folder row for one Drive folder. Returns where its children go.
  async reconcileFolder(item: { id: string; name: string }, parent: { place: Placement; inApp: boolean }): Promise<Placement> {
    if (parent.place === HIDDEN) return HIDDEN
    const name = item.name.slice(0, 255)
    const source: FolderSource = parent.inApp ? 'app' : 'drive'
    const existing = this.rowByDriveId.get(item.id)
    if (existing) {
      if (existing.deletedAt && !existing.deletedBySync) return HIDDEN
      if (this.editedDuringSync(existing)) return existing.deletedAt ? HIDDEN : existing.id
      const parentId = this.keepsAppParent(existing.parentId) ? existing.parentId : parent.place
      if (existing.deletedAt || existing.name !== name || existing.parentId !== parentId || existing.source !== source) {
        const data = { name, parentId, source, deletedAt: null, deletedBySync: false }
        const result = await prisma.folder.updateMany({ where: { id: existing.id, updatedAt: { lt: this.startedAt } }, data })
        if (result.count > 0) Object.assign(existing, data)
      }
      return existing.id
    }
    const folder = await prisma.folder.create({
      data: { userId: this.userId, connectedAccountId: this.account.id, provider: 'google_drive', providerFolderId: item.id, source, name, parentId: parent.place, color: defaultFolderColor, iconUrl: defaultFolderIconUrl },
      select: folderSelect,
    })
    this.rowByDriveId.set(item.id, folder)
    this.folderById.set(folder.id, folder)
    return folder.id
  }

  // An imported folder that left Drive. App folders are left alone.
  async folderGone(row: FolderRow) {
    if (row.source !== 'drive' || row.deletedAt || this.editedDuringSync(row)) return
    const result = await prisma.folder.updateMany({ where: { id: row.id, updatedAt: { lt: this.startedAt } }, data: { deletedAt: new Date(), deletedBySync: true } })
    if (result.count > 0) Object.assign(row, { deletedAt: new Date(), deletedBySync: true })
  }

  // Creates (returns the row to insert) or updates the File row for one Drive file.
  async reconcileFile(item: DriveItem, place: Placement, existing: FileRow | undefined): Promise<Prisma.FileCreateManyInput | undefined> {
    const name = item.name.slice(0, 255)
    const mimeType = item.mimeType.slice(0, 191)
    const sizeBytes = BigInt(item.size ?? 0)
    if (!existing) {
      if (place === HIDDEN) return undefined
      return {
        userId: this.userId, connectedAccountId: this.account.id, provider: 'google_drive', providerFileId: item.id, name, mimeType,
        sizeBytes, status: 'active', folderId: place, createdAt: item.createdTime ? new Date(item.createdTime) : this.startedAt,
      }
    }
    if (this.editedDuringSync(existing)) return undefined
    const metadataChanged = existing.name !== name || existing.mimeType !== mimeType || existing.sizeBytes !== sizeBytes
    let data: Prisma.FileUncheckedUpdateManyInput | undefined
    if (existing.status === 'deleted' && !existing.deletedBySync) {
      // In the app Trash by the user's choice: only refresh metadata.
      if (metadataChanged) data = { name, mimeType, sizeBytes }
    } else if (existing.status === 'deleted' && place === HIDDEN) {
      // Left Drive and came back, but into a folder the user deleted in 9drive: stay out.
      if (metadataChanged) data = { name, mimeType, sizeBytes }
    } else {
      const folderId = place === HIDDEN || this.keepsAppParent(existing.folderId) ? existing.folderId : place
      if (metadataChanged || existing.status !== 'active' || existing.deletedAt !== null || existing.folderId !== folderId) {
        data = { name, mimeType, sizeBytes, status: 'active', deletedAt: null, deletedBySync: false, folderId }
      }
    }
    if (data) {
      const result = await prisma.file.updateMany({ where: { id: existing.id, updatedAt: { lt: this.startedAt } }, data })
      this.updated += result.count
    }
    return undefined
  }

  async filesGone(files: FileRow[]) {
    const ids = files.filter((f) => f.status === 'active' && !this.editedDuringSync(f)).map((f) => f.id)
    if (ids.length === 0) return
    const result = await prisma.file.updateMany({
      where: { id: { in: ids }, userId: this.userId, updatedAt: { lt: this.startedAt } },
      data: { status: 'deleted', deletedAt: new Date(), deletedBySync: true },
    })
    this.deleted += result.count
  }

  async createFiles(rows: Prisma.FileCreateManyInput[]) {
    for (let i = 0; i < rows.length; i += CREATE_BATCH) {
      // An upload finishing mid-sync may have created its row since the snapshot: don't duplicate it.
      let batch = rows.slice(i, i + CREATE_BATCH)
      const taken = await prisma.file.findMany({ where: { userId: this.userId, providerFileId: { in: batch.map((b) => b.providerFileId) } }, select: { providerFileId: true } })
      if (taken.length > 0) {
        const takenIds = new Set(taken.map((t) => t.providerFileId))
        batch = batch.filter((b) => !takenIds.has(b.providerFileId))
      }
      if (batch.length === 0) continue
      const result = await prisma.file.createMany({ data: batch })
      this.created += result.count
    }
  }

  async existingFiles(providerFileIds: string[]) {
    if (providerFileIds.length === 0) return new Map<string, FileRow>()
    const files = await prisma.file.findMany({
      where: { userId: this.userId, connectedAccountId: this.account.id, provider: 'google_drive', providerFileId: { in: providerFileIds } },
      select: fileSelect,
    })
    return new Map(files.map((f) => [f.providerFileId, f]))
  }

  // Active File rows of this account in id order, SWEEP_BATCH at a time (keyset pagination).
  async *activeFileBatches() {
    let lastId = ''
    for (;;) {
      const batch = await prisma.file.findMany({
        where: { userId: this.userId, connectedAccountId: this.account.id, provider: 'google_drive', status: 'active', id: { gt: lastId } },
        select: fileSelect,
        orderBy: { id: 'asc' },
        take: SWEEP_BATCH,
      })
      if (batch.length === 0) return
      yield batch
      lastId = batch[batch.length - 1].id
    }
  }
}

function toItem(file: drive_v3.Schema$File): DriveItem | undefined {
  if (!file.id || !file.name || !file.mimeType) return undefined
  return { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, parents: file.parents, createdTime: file.createdTime }
}

async function runFullSync(account: ConnectedAccount, drive: drive_v3.Drive) {
  const r = new Reconciler(account, drive)
  // Take the changes-feed position before listing, so nothing changed during the listing is missed.
  const startPageToken = (await drive.changes.getStartPageToken({})).data.startPageToken ?? null
  await r.load()

  // Only what this account owns: "Shared with me" items are not part of its My Drive.
  // ---- Folders: the whole tree is needed for placement (ids, names and parents only) ----
  const folderItems = new Map<string, DriveItem>()
  for await (const page of listPages(drive, `mimeType = '${FOLDER_MIME}' and 'me' in owners and trashed = false`, 'id,name,mimeType,parents')) {
    for (const file of page) {
      const item = toItem(file)
      if (item && item.id !== r.appFolderId) folderItems.set(item.id, item)
    }
  }

  // Top-down, so every parent row exists before its children.
  const childrenOf = new Map<string, string[]>()
  for (const folder of folderItems.values()) {
    const parent = folder.parents?.[0]
    // Folders whose parent we can't see (e.g. owned by someone else) hang off My Drive.
    const key = parent && (parent === r.myDriveId || parent === r.appFolderId || folderItems.has(parent)) ? parent : r.myDriveId
    const siblings = childrenOf.get(key)
    if (siblings) siblings.push(folder.id)
    else childrenOf.set(key, [folder.id])
  }
  const placement = new Map<string, { place: Placement; inApp: boolean }>([
    [r.myDriveId, { place: r.accountRoot.id, inApp: false }],
    [r.appFolderId, { place: null, inApp: true }],
  ])
  const queue = [r.myDriveId, r.appFolderId]
  for (let i = 0; i < queue.length; i++) {
    const parent = placement.get(queue[i])!
    for (const driveId of childrenOf.get(queue[i]) ?? []) {
      const place = await r.reconcileFolder(folderItems.get(driveId)!, parent)
      placement.set(driveId, { place, inApp: parent.inApp })
      queue.push(driveId)
    }
  }
  for (const row of [...r.rowByDriveId.values()]) {
    if (row.providerFolderId && !folderItems.has(row.providerFolderId)) await r.folderGone(row)
  }
  childrenOf.clear()
  folderItems.clear()

  // ---- Files: one Drive page at a time, matched against just that page's rows ----
  const seen = new Set<string>()
  for await (const page of listPages(drive, `mimeType != '${FOLDER_MIME}' and 'me' in owners and trashed = false`, 'id,name,mimeType,size,parents,createdTime')) {
    const items: DriveItem[] = []
    for (const file of page) {
      const item = toItem(file)
      if (!item || seen.has(item.id) || !isImportable(item.mimeType)) continue
      seen.add(item.id)
      items.push(item)
    }
    const existing = await r.existingFiles(items.map((i) => i.id))
    const toCreate: Prisma.FileCreateManyInput[] = []
    for (const item of items) {
      const parent = item.parents?.[0]
      const place = (parent && placement.get(parent)?.place) ?? (parent === r.appFolderId ? null : r.accountRoot.id)
      const row = await r.reconcileFile(item, place, existing.get(item.id))
      if (row) toCreate.push(row)
    }
    await r.createFiles(toCreate)
  }

  // ---- Gone from Drive: sweep the active rows in batches ----
  for await (const batch of r.activeFileBatches()) await r.filesGone(batch.filter((f) => !seen.has(f.providerFileId)))

  await prisma.connectedAccount.update({ where: { id: account.id }, data: { driveChangesToken: startPageToken, driveFullSyncAt: r.startedAt } })
  return r
}

class ChangesTokenRejected extends Error {}

async function runIncrementalSync(account: ConnectedAccount, drive: drive_v3.Drive) {
  const r = new Reconciler(account, drive)
  const changes: drive_v3.Schema$Change[] = []
  let pageToken: string | undefined = account.driveChangesToken ?? undefined
  let newStartPageToken: string | undefined
  try {
    while (pageToken) {
      const response = await drive.changes.list({
        pageToken, spaces: 'drive', pageSize: 1000, includeRemoved: true, restrictToMyDrive: true,
        fields: 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,parents,createdTime,trashed,ownedByMe))',
      })
      changes.push(...(response.data.changes ?? []))
      pageToken = response.data.nextPageToken ?? undefined
      newStartPageToken = response.data.newStartPageToken ?? newStartPageToken
    }
  } catch (error) {
    // An expired or invalid page token: start over with a full import.
    const e = error as { response?: { status?: number }; status?: number; code?: number | string }
    const status = Number(e.response?.status ?? e.status ?? e.code)
    if (status === 400 || status === 404 || status === 410) throw new ChangesTokenRejected()
    throw error
  }

  // Latest change per item; the root folder id comes from the 'Drive · email' row when known.
  const latest = new Map<string, drive_v3.Schema$Change>()
  for (const change of changes) if (change.fileId) latest.set(change.fileId, change)
  const accountRoot = await prisma.folder.findFirst({ where: { userId: account.userId, connectedAccountId: account.id, source: 'drive_root', deletedAt: null } })
  await r.load(accountRoot?.providerFolderId ?? undefined)

  const goneIds: string[] = []
  const folderItems: DriveItem[] = []
  const fileItems: DriveItem[] = []
  for (const [fileId, change] of latest) {
    const item = change.file ? toItem(change.file) : undefined
    if (change.removed || !item || change.file?.trashed || change.file?.ownedByMe === false) goneIds.push(fileId)
    else if (item.mimeType === FOLDER_MIME) { if (item.id !== r.appFolderId && item.id !== r.myDriveId) folderItems.push(item) }
    else if (isImportable(item.mimeType)) fileItems.push(item)
  }

  // ---- Folders: place those whose parent is known; repeat until no progress (a new folder can
  // arrive in the same batch as its parent). What's left has an unseen parent: My Drive. ----
  let pending = folderItems
  while (pending.length > 0) {
    const next: DriveItem[] = []
    for (const item of pending) {
      const parent = r.placementOfDriveFolder(item.parents?.[0])
      if (parent) await r.reconcileFolder(item, parent)
      else next.push(item)
    }
    if (next.length === pending.length) {
      for (const item of next) await r.reconcileFolder(item, { place: r.accountRoot.id, inApp: false })
      break
    }
    pending = next
  }

  // ---- Files ----
  const existing = await r.existingFiles([...fileItems.map((f) => f.id), ...goneIds])
  const toCreate: Prisma.FileCreateManyInput[] = []
  for (const item of fileItems) {
    const place = r.placementOfDriveFolder(item.parents?.[0])?.place ?? r.accountRoot.id
    const row = await r.reconcileFile(item, place, existing.get(item.id))
    if (row) toCreate.push(row)
  }
  await r.createFiles(toCreate)

  // ---- Gone: trashed, deleted or no longer owned ----
  await r.filesGone(goneIds.map((id) => existing.get(id)).filter((f): f is FileRow => !!f))
  for (const id of goneIds) {
    const row = r.rowByDriveId.get(id)
    if (row) await r.folderGone(row)
  }

  if (newStartPageToken) await prisma.connectedAccount.update({ where: { id: account.id }, data: { driveChangesToken: newStartPageToken } })
  return r
}

async function runSync(account: ConnectedAccount, forceFull: boolean): Promise<GoogleDriveSyncResult> {
  const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
  const fullDue = !account.driveChangesToken || !account.driveFullSyncAt || Date.now() - account.driveFullSyncAt.getTime() > FULL_SYNC_EVERY_MS
  let mode: GoogleDriveSyncResult['mode'] = forceFull || fullDue ? 'full' : 'incremental'
  let r: Reconciler
  if (mode === 'incremental') {
    try {
      r = await runIncrementalSync(account, drive)
    } catch (error) {
      if (!(error instanceof ChangesTokenRejected)) throw error
      mode = 'full'
      r = await runFullSync(account, drive)
    }
  } else {
    r = await runFullSync(account, drive)
  }
  await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, mode, created: r.created, updated: r.updated, deleted: r.deleted }
}

// One sync per account at a time: overlapping runs would create duplicate rows.
const running = new Map<string, Promise<GoogleDriveSyncResult>>()

export function syncGoogleDrive(accountId: string, userId: string, options: { full?: boolean } = {}) {
  const current = running.get(accountId)
  if (current) return current
  const run = (async () => {
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
    return runSync(account, options.full ?? false)
  })().finally(() => running.delete(accountId))
  running.set(accountId, run)
  return run
}

// Drops what a My Drive import brought into 9drive for this account: the 'Drive · email' folder,
// the imported folders under it, and the File rows inside them. Only database rows go; the files
// stay in Google Drive, and a later reconnect imports them again. Files uploaded through 9drive
// (app root and app folders) are kept. Other accounts' files left inside fall back to the root.
export async function removeImportedDrive(userId: string, accountId: string) {
  await running.get(accountId)?.catch(() => undefined)   // let an in-flight import finish first
  // The next connect starts over with a full import.
  await prisma.connectedAccount.updateMany({ where: { id: accountId, userId }, data: { driveChangesToken: null, driveFullSyncAt: null } })
  const folders = await prisma.folder.findMany({ where: { userId, connectedAccountId: accountId, source: { in: ['drive', 'drive_root'] } }, select: { id: true } })
  const folderIds = folders.map((f) => f.id)
  if (folderIds.length === 0) return { folders: 0, files: 0 }
  const files = await prisma.file.findMany({ where: { userId, connectedAccountId: accountId, folderId: { in: folderIds } }, select: { id: true } })
  const fileIds = files.map((f) => f.id)
  await prisma.workspaceInvite.deleteMany({ where: { inviterId: userId, targetId: { in: [...fileIds, ...folderIds] } } })
  await prisma.file.deleteMany({ where: { id: { in: fileIds }, userId } })
  await prisma.folder.deleteMany({ where: { id: { in: folderIds }, userId } })
  return { folders: folderIds.length, files: fileIds.length }
}

function logSyncError(accountId: string, error: unknown) {
  console.error('[drive-sync] sync failed', { accountId, message: error instanceof Error ? error.message : String(error) })
}

export function syncGoogleDriveInBackground(accountId: string, userId: string, options: { full?: boolean } = {}) {
  syncGoogleDrive(accountId, userId, options).catch((error) => logSyncError(accountId, error))
}

// Keeps every connected Google account in step with Drive. Most ticks read only the changes feed;
// a full import runs when one is due (see runSync).
export function startDriveSyncScheduler(intervalMs = 30 * 60_000) {
  const tick = async () => {
    const accounts = await prisma.connectedAccount.findMany({ where: { provider: 'google_drive', status: 'connected' }, select: { id: true, userId: true } })
    for (const account of accounts) await syncGoogleDrive(account.id, account.userId).catch((error) => logSyncError(account.id, error))
  }
  const run = () => tick().catch((error) => console.error('[drive-sync] scheduler failed', error instanceof Error ? error.message : error))
  const first = setTimeout(run, 60_000)
  const every = setInterval(run, intervalMs)
  first.unref()
  every.unref()
}
