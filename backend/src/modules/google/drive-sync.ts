import { google, type drive_v3 } from './google-apis.js'
import type { ConnectedAccount, Folder, Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { accountLabel } from '../../utils/account-label.js'
import { googleDownloadExportMimeTypes } from '../files/stream-google-file.js'
import { defaultFolderColor, defaultFolderIconUrl, type FolderSource } from '../folders/folder-defaults.js'
import { ensureGoogleAppFolder, getAuthedGoogleClient, syncGoogleQuota } from './google.service.js'

// Imports everything a connected Google account owns in My Drive into 9drive:
// - the `9drive` app folder is the app root (where 9drive uploads go); its subfolders are app folders;
// - the rest of My Drive appears under one folder per account (source 'drive_root', standing for
//   My Drive itself), with Drive's folder tree mirrored as folders with source 'drive'.
// Drive is the source of truth for names and placement, except placements Drive can't represent
// (see keepsAppFolder) and anything the user deleted in 9drive, which stays out until restored.

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.'
const CREATE_BATCH = 500
const HIDDEN = Symbol('hidden')
type Placement = string | null | typeof HIDDEN

export type GoogleDriveSyncResult = { accountId: string; created: number; updated: number; deleted: number }

// Shortcuts and Google-native types we can't download or export (Forms, Sites, ...) are skipped.
function isImportable(mimeType: string) {
  return !mimeType.startsWith(GOOGLE_APPS_PREFIX) || mimeType in googleDownloadExportMimeTypes
}

async function listAll(drive: drive_v3.Drive, q: string, fields: string) {
  const files: drive_v3.Schema$File[] = []
  let pageToken: string | undefined
  do {
    const response = await drive.files.list({ q, spaces: 'drive', fields: `nextPageToken,files(${fields})`, pageSize: 1000, pageToken })
    files.push(...(response.data.files ?? []))
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)
  return files
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
    return prisma.folder.update({ where: { id: existing.id }, data: { deletedAt: null, parentId: null, name, providerFolderId: myDriveId } })
  }
  return existing
}

async function runSync(account: ConnectedAccount): Promise<GoogleDriveSyncResult> {
  const userId = account.userId
  const startedAt = new Date()
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const appFolderId = await ensureGoogleAppFolder(account)
  const myDriveId = (await drive.files.get({ fileId: 'root', fields: 'id' })).data.id
  if (!myDriveId) throw new Error('Google Drive did not return the My Drive folder id.')

  // Only what this account owns: "Shared with me" items are not part of its My Drive.
  const [driveFolders, driveFiles] = await Promise.all([
    listAll(drive, `mimeType = '${FOLDER_MIME}' and 'me' in owners and trashed = false`, 'id,name,parents'),
    listAll(drive, `mimeType != '${FOLDER_MIME}' and 'me' in owners and trashed = false`, 'id,name,mimeType,size,parents,createdTime'),
  ])

  // ---- Folders ----
  const accountRoot = await ensureAccountRootFolder(account, myDriveId)
  const dbFolders = await prisma.folder.findMany({ where: { userId, connectedAccountId: account.id } })
  const rowByDriveId = new Map(dbFolders.filter((f) => f.providerFolderId).map((f) => [f.providerFolderId!, f]))

  const folderById = new Map(driveFolders.filter((f) => f.id && f.name && f.id !== appFolderId).map((f) => [f.id!, { ...f, name: f.name!.slice(0, 255) }]))
  const childrenOf = new Map<string, string[]>()
  for (const folder of folderById.values()) {
    const parent = folder.parents?.[0]
    // Folders whose parent we can't see (e.g. owned by someone else) hang off My Drive.
    const key = parent && (parent === myDriveId || parent === appFolderId || folderById.has(parent)) ? parent : myDriveId
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), folder.id!])
  }

  // Where each Drive folder lives in 9drive: a folder row id, null for the app root, or HIDDEN
  // when the user deleted it (or an ancestor) in 9drive.
  const placement = new Map<string, Placement>([[myDriveId, accountRoot.id], [appFolderId, null]])
  const inAppTree = new Set<string>([appFolderId])
  let created = 0
  let updated = 0
  let deleted = 0

  const queue = [myDriveId, appFolderId]
  while (queue.length > 0) {
    const parentDriveId = queue.shift()!
    const parentPlacement = placement.get(parentDriveId)!
    for (const driveId of childrenOf.get(parentDriveId) ?? []) {
      queue.push(driveId)
      const inApp = inAppTree.has(parentDriveId)
      if (inApp) inAppTree.add(driveId)
      if (parentPlacement === HIDDEN) {
        placement.set(driveId, HIDDEN)
        continue
      }
      const driveFolder = folderById.get(driveId)!
      const source: FolderSource = inApp ? 'app' : 'drive'
      const existing = rowByDriveId.get(driveId)
      if (existing?.deletedAt) {
        placement.set(driveId, HIDDEN)
        continue
      }
      if (existing) {
        if (existing.name !== driveFolder.name || existing.parentId !== parentPlacement || existing.source !== source) {
          await prisma.folder.update({ where: { id: existing.id }, data: { name: driveFolder.name!, parentId: parentPlacement, source } })
        }
        placement.set(driveId, existing.id)
        continue
      }
      const folder = await prisma.folder.create({
        data: { userId, connectedAccountId: account.id, provider: 'google_drive', providerFolderId: driveId, source, name: driveFolder.name!, parentId: parentPlacement, color: defaultFolderColor, iconUrl: defaultFolderIconUrl },
      })
      placement.set(driveId, folder.id)
    }
  }

  // Imported folders that are gone from Drive. App folders are left alone, as before.
  const goneFolderIds = dbFolders.filter((f) => f.source === 'drive' && !f.deletedAt && f.providerFolderId && !folderById.has(f.providerFolderId)).map((f) => f.id)
  if (goneFolderIds.length > 0) await prisma.folder.updateMany({ where: { id: { in: goneFolderIds }, userId }, data: { deletedAt: startedAt } })

  // ---- Files ----
  const allUserFolders = new Map<string, Pick<Folder, 'connectedAccountId' | 'providerFolderId' | 'deletedAt'>>(
    (await prisma.folder.findMany({ where: { userId }, select: { id: true, connectedAccountId: true, providerFolderId: true, deletedAt: true } })).map((f) => [f.id, f]),
  )
  // A placement Drive can't represent (folder bound to another account, or without a Drive
  // mirror) is app-side only: keep it instead of resetting it from the Drive parent.
  const keepsAppFolder = (folderId: string | null) => {
    if (!folderId) return false
    const folder = allUserFolders.get(folderId)
    return !!folder && !folder.deletedAt && (folder.connectedAccountId !== account.id || !folder.providerFolderId)
  }

  const existingFiles = await prisma.file.findMany({ where: { userId, connectedAccountId: account.id, provider: 'google_drive' } })
  const existingByProviderId = new Map(existingFiles.map((file) => [file.providerFileId, file]))
  const seen = new Set<string>()
  const toCreate: Prisma.FileCreateManyInput[] = []

  for (const driveFile of driveFiles) {
    if (!driveFile.id || !driveFile.name || !driveFile.mimeType || seen.has(driveFile.id) || !isImportable(driveFile.mimeType)) continue
    seen.add(driveFile.id)
    const parent = driveFile.parents?.[0]
    const place: Placement = parent && placement.has(parent) ? placement.get(parent)! : accountRoot.id
    const sizeBytes = BigInt(driveFile.size ?? 0)
    const mimeType = driveFile.mimeType.slice(0, 191)
    const existing = existingByProviderId.get(driveFile.id)

    if (!existing) {
      if (place === HIDDEN) continue
      toCreate.push({
        userId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: driveFile.id, name: driveFile.name.slice(0, 255), mimeType,
        sizeBytes, status: 'active', folderId: place, createdAt: driveFile.createdTime ? new Date(driveFile.createdTime) : startedAt,
      })
      continue
    }

    // Files in the app Trash stay there; sync only refreshes their metadata.
    const trashed = existing.status === 'deleted'
    const folderId = place === HIDDEN || keepsAppFolder(existing.folderId) ? existing.folderId : place
    const name = driveFile.name.slice(0, 255)
    const metadataChanged = existing.name !== name || existing.mimeType !== mimeType || existing.sizeBytes !== sizeBytes
    const placementChanged = !trashed && (existing.status !== 'active' || existing.deletedAt !== null || existing.folderId !== folderId)
    if (metadataChanged || placementChanged) {
      await prisma.file.update({
        where: { id: existing.id },
        data: trashed
          ? { name, mimeType, sizeBytes }
          : { name, mimeType, sizeBytes, status: 'active', deletedAt: null, folderId },
      })
      updated += 1
    }
  }

  for (let i = 0; i < toCreate.length; i += CREATE_BATCH) {
    const result = await prisma.file.createMany({ data: toCreate.slice(i, i + CREATE_BATCH) })
    created += result.count
  }

  // Gone from Drive. Rows touched after the listing started (e.g. an upload finishing
  // mid-sync) are not in the listing yet, so leave them alone.
  const missingIds = existingFiles
    .filter((file) => file.status === 'active' && !seen.has(file.providerFileId) && file.updatedAt < startedAt)
    .map((file) => file.id)
  if (missingIds.length > 0) {
    const result = await prisma.file.updateMany({ where: { id: { in: missingIds }, userId }, data: { status: 'deleted', deletedAt: new Date() } })
    deleted = result.count
  }

  await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}

// One sync per account at a time: overlapping runs would create duplicate rows.
const running = new Map<string, Promise<GoogleDriveSyncResult>>()

export function syncGoogleDrive(accountId: string, userId: string) {
  const current = running.get(accountId)
  if (current) return current
  const run = (async () => {
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
    return runSync(account)
  })().finally(() => running.delete(accountId))
  running.set(accountId, run)
  return run
}

function logSyncError(accountId: string, error: unknown) {
  console.error('[drive-sync] sync failed', { accountId, message: error instanceof Error ? error.message : String(error) })
}

export function syncGoogleDriveInBackground(accountId: string, userId: string) {
  syncGoogleDrive(accountId, userId).catch((error) => logSyncError(accountId, error))
}

// Re-imports every connected Google account periodically so changes made in Drive show up.
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
