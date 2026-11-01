import { Router } from 'express'
import { google } from '../google/google-apis.js'
import { z } from 'zod'
import type { Folder } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { HttpError } from '../../middleware/error.middleware.js'
import { applyDriveChange, driveParentForFolder, getAuthedGoogleClient, ensureGoogleAppFolder, googleDriveFolderMimeType, moveGoogleFile } from '../google/google.service.js'
import { createAuditLog } from '../../utils/audit.js'
import { removeImportedDrive } from '../google/drive-sync.js'
import { defaultFolderColor, defaultFolderIconUrl } from './folder-defaults.js'

export const folderRouter = Router()
folderRouter.use(requireAuth)

const iconUrlSchema = z.string().url().startsWith('https://api.iconify.design/lucide:').max(2048)
const colorSchema = z.string().regex(/^(#[0-9a-fA-F]{6}|text-[a-z]+-[0-9]+)$/).max(64)

const createSchema = z.object({
  name: z.string().min(1).max(255),
  color: colorSchema.optional(),
  iconUrl: iconUrlSchema.nullable().optional(),
  parentId: z.string().nullable().optional(),
})

const folderSelect = { id: true, name: true, color: true, iconUrl: true, parentId: true, providerFolderId: true, connectedAccountId: true, source: true, createdAt: true, updatedAt: true } as const

// An imported My Drive can hold tens of thousands of folders: lists are capped, and nothing loads
// every folder at once.
const FOLDER_LIST_CAP = 2000
const ID_BATCH = 1000

// Ids of a folder and everything below it (not deleted), one tree level at a time.
async function folderWithDescendants(userId: string, rootId: string) {
  const ids = new Set([rootId])
  let frontier = [rootId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (let i = 0; i < frontier.length; i += ID_BATCH) {
      const children = await prisma.folder.findMany({ where: { userId, deletedAt: null, parentId: { in: frontier.slice(i, i + ID_BATCH) } }, select: { id: true } })
      for (const child of children) {
        if (ids.has(child.id)) continue   // a parent cycle in bad data must not loop forever
        ids.add(child.id)
        next.push(child.id)
      }
    }
    frontier = next
  }
  return [...ids]
}

// The folder and its ancestors, from the top level down (deleted folders end the chain).
async function folderPath(userId: string, folderId: string) {
  const path: Array<{ id: string; name: string; parentId: string | null }> = []
  const visited = new Set<string>()
  let id: string | null = folderId
  while (id && !visited.has(id)) {
    visited.add(id)
    const folder: { id: string; name: string; parentId: string | null } | null = await prisma.folder.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true, name: true, parentId: true } })
    if (!folder) break
    path.unshift(folder)
    id = folder.parentId
  }
  return path
}

function serializeFolder(folder: { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; connectedAccountId?: string | null; source?: string; createdAt: Date; updatedAt: Date }) {
  return { ...folder, providerFolderId: folder.providerFolderId ?? null, connectedAccountId: folder.connectedAccountId ?? null, createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString() }
}

// The account and Drive parent a new folder's Drive mirror goes under: the parent folder's own
// account when it has a Drive mirror (imported Drive folders, or app folders), otherwise the
// first connected Google account's 9drive folder.
async function driveTargetForParent(userId: string, parent: Pick<Folder, 'connectedAccountId' | 'providerFolderId'> | null) {
  if (parent?.providerFolderId && parent.connectedAccountId) {
    const account = await prisma.connectedAccount.findFirst({ where: { id: parent.connectedAccountId, userId, provider: 'google_drive', status: 'connected' } })
    return account ? { account, parentDriveId: parent.providerFolderId } : null
  }
  const account = await prisma.connectedAccount.findFirst({ where: { userId, provider: 'google_drive', status: 'connected' } })
  return account ? { account, parentDriveId: await ensureGoogleAppFolder(account) } : null
}

async function ensureProviderFolderIds(
  folders: Array<{ id: string; name: string; parentId: string | null; providerFolderId: string | null; connectedAccountId: string | null }>,
  userId: string
) {
  const foldersWithoutId = folders.filter((f) => !f.providerFolderId)
  if (foldersWithoutId.length === 0) return

  for (const folder of foldersWithoutId) {
    try {
      const parentFolder = folder.parentId ? await prisma.folder.findFirst({ where: { id: folder.parentId, userId } }) : null
      const target = await driveTargetForParent(userId, parentFolder)
      if (!target) return
      const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(target.account) })
      const driveFolder = await drive.files.create({
        requestBody: { name: folder.name, mimeType: googleDriveFolderMimeType, parents: [target.parentDriveId] },
        fields: 'id'
      })
      const gId = driveFolder.data.id ?? null
      if (gId) {
        await prisma.folder.update({ where: { id: folder.id }, data: { providerFolderId: gId, connectedAccountId: target.account.id } })
        folder.providerFolderId = gId
        folder.connectedAccountId = target.account.id
      }
    } catch (error) {
      console.error(`Failed self-healing for folder ${folder.id}:`, error)
    }
  }
}

folderRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      parentId: z.string().nullable().optional(),
      q: z.string().trim().min(1).max(255).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).parse(req.query)
    if (query.q) {
      // Name search across every folder (folder pickers): small, with the parent's name to tell
      // same-named folders apart.
      const folders = await prisma.folder.findMany({
        where: { userId: req.user!.id, deletedAt: null, name: { contains: query.q } },
        select: { ...folderSelect, parent: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: query.limit ?? 50,
      })
      return res.json({ folders: folders.map(({ parent, ...folder }) => ({ ...serializeFolder(folder), parentName: parent?.name ?? null })) })
    }
    const folders = await prisma.folder.findMany({
      where: { userId: req.user!.id, deletedAt: null, parentId: query.parentId ?? null },
      select: folderSelect,
      orderBy: { updatedAt: 'desc' },
      take: FOLDER_LIST_CAP + 1,
    })
    const hasMore = folders.length > FOLDER_LIST_CAP
    if (hasMore) folders.length = FOLDER_LIST_CAP
    await ensureProviderFolderIds(folders, req.user!.id)
    return res.json({ folders: folders.map(serializeFolder), hasMore })
  } catch (error) {
    return next(error)
  }
})

folderRouter.get('/recent', async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 4), 4)
    const folders = await prisma.folder.findMany({
      where: { userId: req.user!.id, deletedAt: null },
      select: folderSelect,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    await ensureProviderFolderIds(folders, req.user!.id)
    return res.json({ folders: folders.map(serializeFolder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.get('/:id/path', async (req: AuthRequest, res, next) => {
  try {
    return res.json({ path: await folderPath(req.user!.id, String(req.params.id)) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.post('/', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    let parentFolder: Folder | null = null
    if (body.parentId) {
      parentFolder = await prisma.folder.findFirstOrThrow({
        where: { id: body.parentId, userId: req.user!.id, deletedAt: null }
      })
    }

    let providerFolderId: string | null = null
    let connectedAccountId: string | null = null
    try {
      const target = await driveTargetForParent(req.user!.id, parentFolder)
      if (target) {
        connectedAccountId = target.account.id
        const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(target.account) })
        const driveFolder = await drive.files.create({
          requestBody: { name: body.name, mimeType: googleDriveFolderMimeType, parents: [target.parentDriveId] },
          fields: 'id'
        })
        providerFolderId = driveFolder.data.id ?? null
      }
    } catch (error) {
      console.error('Failed to create folder on Google Drive:', error)
    }

    const folder = await prisma.folder.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        color: body.color ?? defaultFolderColor,
        iconUrl: body.iconUrl ?? defaultFolderIconUrl,
        parentId: body.parentId ?? null,
        providerFolderId,
        connectedAccountId,
        // A folder made inside an imported Drive tree is a Drive folder like its siblings.
        source: parentFolder && parentFolder.source !== 'app' ? 'drive' : 'app',
      },
      select: folderSelect,
    })
    await createAuditLog(req.user!.id, 'CREATE_FOLDER', 'folder', folder.id, { name: folder.name })
    return res.status(201).json({ folder: serializeFolder(folder) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = createSchema.partial().parse(req.body)
    const folderId = String(req.params.id)
    if (body.parentId === folderId) return res.status(400).json({ code: 'FOLDER_INVALID_PARENT', message: 'Folder cannot be moved into itself.' })

    const folderRecord = await prisma.folder.findFirstOrThrow({
      where: { id: folderId, userId: req.user!.id, deletedAt: null },
      include: { connectedAccount: true }
    })
    const renaming = body.name !== undefined && body.name !== folderRecord.name
    const moving = body.parentId !== undefined && (body.parentId ?? null) !== folderRecord.parentId
    if (folderRecord.source === 'drive_root' && (renaming || moving)) {
      return res.status(400).json({ code: 'FOLDER_LOCKED', message: 'This folder stands for a connected Drive account and can’t be renamed or moved.' })
    }

    let newParent: Folder | null = null
    if (moving && body.parentId) {
      newParent = await prisma.folder.findFirstOrThrow({ where: { id: body.parentId, userId: req.user!.id, deletedAt: null } })
      // The target is inside this folder when this folder is one of the target's ancestors.
      const targetPath = await folderPath(req.user!.id, body.parentId)
      if (targetPath.some((folder) => folder.id === folderId)) return res.status(400).json({ code: 'FOLDER_INVALID_PARENT', message: 'Folder cannot be moved into itself or a child folder.' })
    }

    // A folder with a Drive mirror can only go where Drive can follow: a folder with a Drive
    // counterpart on the same account, or the app root (that account's 9drive folder).
    // Drive is only kept in step while the bound account is connected (see applyDriveChange).
    const account = folderRecord.providerFolderId && folderRecord.connectedAccount?.status === 'connected' ? folderRecord.connectedAccount : null
    let parentDriveId: string | null = null
    if (moving && account) {
      parentDriveId = (await applyDriveChange(account, () => driveParentForFolder(account, newParent))) ?? null
      if (!parentDriveId) return res.status(400).json({ code: 'FOLDER_MOVE_ACROSS_ACCOUNTS', message: 'This folder lives in a different Drive account than the target folder.' })
    }

    // Drive changes go first and fail the request: Google sync treats Drive as the source of
    // truth, so a change made only in the database would be undone on the next sync.
    if (account && folderRecord.providerFolderId) {
      const driveFolderId = folderRecord.providerFolderId
      if (renaming) {
        await applyDriveChange(account, async () => {
          const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(account) })
          await drive.files.update({ fileId: driveFolderId, requestBody: { name: body.name } })
        })
      }
      if (moving && parentDriveId) await applyDriveChange(account, () => moveGoogleFile(account, driveFolderId, parentDriveId!))
    }

    const folder = await prisma.folder.updateMany({
      where: { id: folderId, userId: req.user!.id, deletedAt: null },
      data: { ...(body.name ? { name: body.name } : {}), ...(body.color ? { color: body.color } : {}), ...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}), ...(body.parentId !== undefined ? { parentId: body.parentId } : {}) },
    })
    if (folder.count === 0) return res.status(404).json({ code: 'FOLDER_NOT_FOUND', message: 'Folder not found.' })
    const updated = await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId: req.user!.id }, select: folderSelect })
    await createAuditLog(req.user!.id, 'UPDATE_FOLDER', 'folder', updated.id, { name: updated.name, updates: body })
    return res.json({ folder: serializeFolder(updated) })
  } catch (error) {
    return next(error)
  }
})

folderRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const rootId = String(req.params.id)
    const root = await prisma.folder.findFirstOrThrow({ where: { id: rootId, userId: req.user!.id, deletedAt: null } })
    if (root.source === 'drive_root') {
      const account = root.connectedAccountId ? await prisma.connectedAccount.findFirst({ where: { id: root.connectedAccountId, userId: req.user!.id } }) : null
      if (account?.status === 'connected') throw new HttpError(400, 'FOLDER_LOCKED', 'This folder stands for a connected Drive account. Disconnect the account to remove it.')
      // Left over from an account that is gone or disconnected: remove the whole import.
      await removeImportedDrive(req.user!.id, root.connectedAccountId ?? '')
      if (!root.connectedAccountId) await prisma.folder.delete({ where: { id: root.id } })
      await createAuditLog(req.user!.id, 'DELETE_FOLDER', 'folder', root.id, { name: root.name })
      return res.json({ status: 'ok' })
    }
    const folderIds = await folderWithDescendants(req.user!.id, root.id)

    // Soft delete only: files go to Trash and stay in storage until the user deletes them permanently.
    // Drive folders are left in place because deleting a Drive folder also deletes everything inside it.
    // Files first, so a failure part way never leaves files hidden inside deleted folders.
    const now = new Date()
    for (let i = 0; i < folderIds.length; i += ID_BATCH) {
      await prisma.file.updateMany({ where: { userId: req.user!.id, status: 'active', folderId: { in: folderIds.slice(i, i + ID_BATCH) } }, data: { status: 'deleted', deletedAt: now, deletedBySync: false } })
    }
    for (let i = 0; i < folderIds.length; i += ID_BATCH) {
      await prisma.folder.updateMany({ where: { id: { in: folderIds.slice(i, i + ID_BATCH) }, userId: req.user!.id }, data: { deletedAt: now, deletedBySync: false } })
    }

    await createAuditLog(req.user!.id, 'DELETE_FOLDER', 'folder', root.id, { name: root.name })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})
