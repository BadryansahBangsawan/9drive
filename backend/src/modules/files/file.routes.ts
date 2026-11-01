import { Router } from 'express'
import { google } from '../google/google-apis.js'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { shareExpiresAt } from '../../utils/share-expiry.js'
import type { ConnectedAccount, File, Folder } from '@prisma/client'
import { applyDriveChange, driveParentForFolder, getAuthedGoogleClient, moveGoogleFile, syncGoogleQuota } from '../google/google.service.js'
import { syncGoogleDrive } from '../google/drive-sync.js'
import { deleteS3Object, syncS3Quota, createS3Client, getS3ConfigForAccount } from '../s3/s3.service.js'
import { streamProviderFile } from './stream-file.js'
import { newShareToken, readShareToken, shareUrl } from './share-token.js'
import { googleDownloadExportMimeTypes, normalizeHeaders, withExtension } from './stream-google-file.js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { createAuditLog } from '../../utils/audit.js'
import { env } from '../../config/env.js'
import { mayHaveThumbnail, thumbnailPath, verifyThumbnailSignature } from '../../utils/thumbnail.js'
import { pipeToResponse, setFileResponseHeaders } from './file-response.js'

// Thumbnail signatures use a key derived from the JWT secret, so they can't be confused with tokens.
const thumbnailSecret = `${env.JWT_ACCESS_SECRET}:thumbnails`
const THUMBNAIL_CACHE = 'private, max-age=21600'



export const fileRouter = Router()

// Most rows a file list returns in one response (newest first); hasMore says there are more.
const FILE_LIST_CAP = 2000

fileRouter.get('/preview/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token)
    const preview = await prisma.filePreviewToken.findFirst({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      include: { file: { include: { connectedAccount: true } } },
    })
    if (!preview || preview.file.status !== 'active') return res.status(404).json({ code: 'PREVIEW_NOT_FOUND', message: 'Preview token not found.' })
    return streamProviderFile(preview.file, req.headers.range, res, { disposition: 'inline' })
  } catch (error) {
    return next(error)
  }
})

// A file's thumbnail for <img src> (signed URL from the file list; no bearer token). Google Drive
// renders it (thumbnailLink, fetched with the account's token); small S3 images are sent as they are.
fileRouter.get('/thumbnail/:id', async (req, res, next) => {
  try {
    const fileId = String(req.params.id)
    const query = z.object({ exp: z.coerce.number(), sig: z.string() }).safeParse(req.query)
    const notFound = () => res.status(404).json({ code: 'THUMBNAIL_NOT_FOUND', message: 'No thumbnail.' })
    if (!query.success || !verifyThumbnailSignature(thumbnailSecret, fileId, query.data.exp, query.data.sig)) return notFound()
    const file = await prisma.file.findFirst({ where: { id: fileId, status: 'active' }, include: { connectedAccount: true } })
    if (!file || !mayHaveThumbnail(file)) return notFound()

    if (file.provider === 's3') {
      const config = await getS3ConfigForAccount(file.connectedAccountId)
      const object = await createS3Client(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
      if (!object.Body) return notFound()
      setFileResponseHeaders(res, { mimeType: file.mimeType, fileName: file.name, disposition: 'inline' })
      res.setHeader('Cache-Control', THUMBNAIL_CACHE)
      if (object.ContentLength !== undefined) res.setHeader('Content-Length', String(object.ContentLength))
      return pipeToResponse(object.Body as Readable, res)
    }

    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const metadata = await google.drive({ version: 'v3', auth }).files.get({ fileId: file.providerFileId, fields: 'thumbnailLink' }).catch(() => null)
    const link = metadata?.data.thumbnailLink
    if (!link) return notFound()
    // thumbnailLink ends in =s220 (220 px); ask for a size that stays sharp on a 2x screen.
    const response = await fetch(link.replace(/=s\d+$/, '=s480'), { headers: normalizeHeaders(await auth.getRequestHeaders()) })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !response.body || !contentType.startsWith('image/')) return notFound()
    setFileResponseHeaders(res, { mimeType: contentType, fileName: 'thumbnail', disposition: 'inline' })
    res.setHeader('Cache-Control', THUMBNAIL_CACHE)
    return pipeToResponse(response.body as unknown as Parameters<typeof pipeToResponse>[0], res)
  } catch (error) {
    return next(error)
  }
})

fileRouter.use(requireAuth)

fileRouter.get('/', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({
      // 'root' lists only files at the top level; omitted lists files in every folder.
      folderId: z.string().optional(),
      q: z.string().trim().max(255).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
      kind: z.enum(['image', 'video', 'pdf', 'doc', 'archive']).optional(),
      accountId: z.string().optional(),
      minSize: z.coerce.number().int().nonnegative().optional(),
      maxSize: z.coerce.number().int().nonnegative().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional()
    }).parse(req.query)

    const typeFilters: Record<string, string[]> = {
      image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
      video: ['video/mp4', 'video/mpeg', 'video/ogg', 'video/quicktime', 'video/webm'],
      pdf: ['application/pdf'],
      doc: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
      archive: ['application/zip', 'application/x-rar-compressed', 'application/x-tar', 'application/x-7z-compressed']
    }

    const where: any = {
      userId: req.user!.id,
      status: 'active',
      ...(query.folderId ? { folderId: query.folderId === 'root' ? null : query.folderId } : {}),
      ...(query.q ? { name: { contains: query.q } } : {}),
      ...(query.accountId ? { connectedAccountId: query.accountId } : {}),
      ...(query.kind ? { mimeType: { in: typeFilters[query.kind] || [] } } : {}),
      ...(query.minSize !== undefined || query.maxSize !== undefined ? {
        sizeBytes: {
          ...(query.minSize !== undefined ? { gte: BigInt(query.minSize) } : {}),
          ...(query.maxSize !== undefined ? { lte: BigInt(query.maxSize) } : {})
        }
      } : {}),
      ...(query.startDate || query.endDate ? {
        createdAt: {
          ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
          ...(query.endDate ? { lte: new Date(query.endDate) } : {})
        }
      } : {})
    }

    const files = await prisma.file.findMany({
      where,
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true, displayName: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: (query.limit ?? FILE_LIST_CAP) + 1,
    })
    // An imported My Drive can hold hundreds of thousands of files: never return them all at once.
    const cap = query.limit ?? FILE_LIST_CAP
    return res.json({ files: files.slice(0, cap).map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString(), thumbnailPath: thumbnailPath(thumbnailSecret, file) })), hasMore: files.length > cap })
  } catch (error) {
    return next(error)
  }
})

const batchFileSchema = z.object({ fileIds: z.array(z.string().min(1)).min(1).max(100) })
const shareBodySchema = z.object({ expiresIn: z.enum(['never', '1d', '7d', '30d']).optional() })

// Mirrors an in-app move on Drive so `POST /files/sync-google` doesn't undo it. Only possible when
// the target folder has a Drive mirror on the file's account (or is the root `9drive` folder);
// otherwise the move stays app-side and sync leaves `folderId` alone.
function createDriveMover() {
  const appFolderIds = new Map<string, Promise<string>>()
  return async (file: File & { connectedAccount: ConnectedAccount }, folder: Folder | null) => {
    if (file.provider !== 'google_drive') return
    await applyDriveChange(file.connectedAccount, async () => {
      const parentId = await driveParentForFolder(file.connectedAccount, folder, appFolderIds)
      if (parentId) await moveGoogleFile(file.connectedAccount, file.providerFileId, parentId)
    })
  }
}

fileRouter.patch('/batch', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.extend({ folderId: z.string().nullable().optional() }).parse(req.body)
    const targetFolderId = body.folderId ?? null
    const targetFolder = targetFolderId ? await prisma.folder.findFirstOrThrow({ where: { id: targetFolderId, userId: req.user!.id, deletedAt: null } }) : null
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' }, include: { connectedAccount: true } })
    const moveOnDrive = createDriveMover()
    const movedIds: string[] = []
    const failed: Array<{ fileId: string; message: string }> = []
    for (const file of files) {
      try {
        if (file.folderId !== targetFolderId) await moveOnDrive(file, targetFolder)
        movedIds.push(file.id)
      } catch (error) {
        failed.push({ fileId: file.id, message: error instanceof Error ? error.message : 'Move failed' })
      }
    }
    const result = await prisma.file.updateMany({ where: { id: { in: movedIds }, userId: req.user!.id, status: 'active' }, data: { folderId: targetFolderId } })
    await createAuditLog(req.user!.id, 'MOVE_FILES', 'file', undefined, { count: result.count, folderId: body.folderId })
    if (movedIds.length === 0 && failed.length > 0) {
      return res.status(400).json({ code: 'FILES_MOVE_FAILED', message: 'No files were moved.', moved: 0, failed })
    }
    return res.json({ status: 'ok', moved: result.count, failed })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/batch', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' } })
    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' },
      data: { status: 'deleted', deletedAt: new Date(), deletedBySync: false }
    })
    for (const f of files) {
      await createAuditLog(req.user!.id, 'TRASH_FILE', 'file', f.id, { name: f.name })
    }
    return res.json({ status: 'ok', deleted: result.count })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/trash', async (req: AuthRequest, res, next) => {
  try {
    const query = z.object({ q: z.string().trim().max(255).optional() }).parse(req.query)
    const files = await prisma.file.findMany({
      where: {
        userId: req.user!.id,
        status: 'deleted',
        ...(query.q ? { name: { contains: query.q } } : {})
      },
      include: {
        connectedAccount: { select: { id: true, email: true, provider: true, displayName: true } },
        folder: { select: { id: true, name: true } }
      },
      orderBy: { deletedAt: 'desc' },
      take: FILE_LIST_CAP + 1,
    })
    return res.json({ files: files.slice(0, FILE_LIST_CAP).map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })), hasMore: files.length > FILE_LIST_CAP })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/batch/restore', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({ where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' }, include: { folder: { select: { deletedAt: true } } } })
    const result = await prisma.file.updateMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      data: { status: 'active', deletedAt: null, deletedBySync: false }
    })
    // A file restored out of a deleted folder goes back to the root instead of an invisible folder.
    const orphanedIds = files.filter((file) => file.folder?.deletedAt).map((file) => file.id)
    if (orphanedIds.length > 0) await prisma.file.updateMany({ where: { id: { in: orphanedIds }, userId: req.user!.id }, data: { folderId: null } })
    for (const f of files) {
      await createAuditLog(req.user!.id, 'RESTORE_FILE', 'file', f.id, { name: f.name })
    }
    return res.json({ status: 'ok', restored: result.count })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/batch/permanent', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'deleted' },
      include: { connectedAccount: true }
    })
    const deletedIds: string[] = []
    const syncedAccountIds = new Set<string>()
    const failed: Array<{ fileId: string; message: string }> = []

    for (const file of files) {
      try {
        if (file.provider === 's3') {
          await deleteS3Object(file)
        } else {
          const auth = await getAuthedGoogleClient(file.connectedAccount)
          const drive = google.drive({ version: 'v3', auth })
          await drive.files.delete({ fileId: file.providerFileId })
        }
        deletedIds.push(file.id)
        syncedAccountIds.add(file.connectedAccountId)
        await createAuditLog(req.user!.id, 'PERMANENT_DELETE_FILE', 'file', file.id, { name: file.name })
      } catch (error) {
        failed.push({ fileId: file.id, message: error instanceof Error ? error.message : 'Delete failed' })
      }
    }

    if (deletedIds.length > 0) {
      await prisma.file.deleteMany({
        where: { id: { in: deletedIds }, userId: req.user!.id }
      })
    }

    for (const accountId of syncedAccountIds) {
      const account = files.find((file) => file.connectedAccountId === accountId)?.connectedAccount
      if (account?.provider === 's3') {
        await syncS3Quota(accountId).catch(() => undefined)
      } else {
        await syncGoogleQuota(accountId).catch(() => undefined)
      }
    }

    if (deletedIds.length === 0 && failed.length > 0) {
      return res.status(400).json({ code: 'FILES_DELETE_FAILED', message: 'No files were permanently deleted.', deleted: 0, failed })
    }
    return res.json({ status: 'ok', deleted: deletedIds.length, failed })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/shared-links', async (req: AuthRequest, res, next) => {
  try {
    const shares = await prisma.fileShare.findMany({
      where: { userId: req.user!.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { file: { include: { connectedAccount: { select: { email: true, provider: true, displayName: true } }, folder: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    return res.json({
      shares: shares.filter((share) => share.file.status === 'active').map((share) => {
        const token = readShareToken(share)
        const url = token ? shareUrl(token) : null
        return {
          id: share.id,
          url,
          createdAt: share.createdAt.toISOString(),
          expiresAt: share.expiresAt?.toISOString() ?? null,
          file: { ...share.file, sizeBytes: share.file.sizeBytes.toString() },
        }
      })
    })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/sync-google', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ connectedAccountId: z.string().min(1).optional() }).parse(req.body ?? {})
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: req.user!.id, provider: 'google_drive', status: 'connected', ...(body.connectedAccountId ? { id: body.connectedAccountId } : {}) },
      select: { id: true },
    })

    // A large Drive can take longer than a proxy will hold the request open (Cloudflare: ~100 s),
    // so answer 202 if it isn't done soon; the sync keeps running and the files appear when it ends.
    const work = Promise.all(accounts.map((account) => syncGoogleDrive(account.id, req.user!.id)
      .catch((error) => ({ accountId: account.id, created: 0, updated: 0, deleted: 0, error: error instanceof Error ? error.message : 'Sync failed' }))))
    let timer: NodeJS.Timeout | undefined
    const results = await Promise.race([work, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 45_000) })])
    clearTimeout(timer)
    if (!results) return res.status(202).json({ status: 'running', results: [] })
    return res.json({ status: 'ok', results })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: { select: { id: true, email: true, provider: true, displayName: true } }, folder: { select: { id: true, name: true } } } })
    return res.json({ file: { ...file, sizeBytes: file.sizeBytes.toString() } })
  } catch (error) {
    return next(error)
  }
})

fileRouter.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1).max(255).optional(), folderId: z.string().nullable().optional() }).parse(req.body)
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' }, include: { connectedAccount: true } })
    const targetFolder = body.folderId ? await prisma.folder.findFirstOrThrow({ where: { id: body.folderId, userId: req.user!.id, deletedAt: null } }) : null
    if (body.name && body.name !== file.name && file.provider === 'google_drive') {
      await applyDriveChange(file.connectedAccount, async () => {
        const drive = google.drive({ version: 'v3', auth: await getAuthedGoogleClient(file.connectedAccount) })
        await drive.files.update({ fileId: file.providerFileId, requestBody: { name: body.name } })
      })
    }
    if (body.folderId !== undefined && (body.folderId ?? null) !== file.folderId) await createDriveMover()(file, targetFolder)
    const updated = await prisma.file.update({ where: { id: file.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.folderId !== undefined ? { folderId: body.folderId } : {}) }, include: { connectedAccount: { select: { id: true, email: true, provider: true, displayName: true } }, folder: { select: { id: true, name: true } } } })
    await createAuditLog(req.user!.id, 'UPDATE_FILE', 'file', updated.id, { name: updated.name, updates: body })
    return res.json({ file: { ...updated, sizeBytes: updated.sizeBytes.toString() } })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' } })
    const activeShare = await prisma.fileShare.findFirst({ where: { fileId: file.id, userId: req.user!.id, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } })

    const body = shareBodySchema.parse(req.body ?? {})
    // Very old rows stored only the token hash, so their URL can't be rebuilt: replace them
    // with a fresh link (keeping the expiry) instead of returning /public/files/undefined.
    const recoveredToken = activeShare ? readShareToken(activeShare) : null
    if (activeShare && !recoveredToken) await prisma.fileShare.update({ where: { id: activeShare.id }, data: { enabled: false } })
    const existingShare = recoveredToken ? activeShare : null

    let shareId = existingShare?.id
    let token = recoveredToken
    let expiresAt = existingShare?.expiresAt ?? null
    if (!existingShare) {
      const issued = newShareToken()
      token = issued.token
      expiresAt = body.expiresIn ? shareExpiresAt(body.expiresIn) : (activeShare?.expiresAt ?? null)
      const share = await prisma.fileShare.create({ data: { fileId: file.id, userId: req.user!.id, ...issued.data, expiresAt } })
      shareId = share.id
      await createAuditLog(req.user!.id, 'CREATE_SHARE_LINK', 'file', file.id, { name: file.name, expiresAt: expiresAt?.toISOString() ?? null })
    } else if (body.expiresIn) {
      expiresAt = shareExpiresAt(body.expiresIn)
      await prisma.fileShare.update({ where: { id: existingShare.id }, data: { expiresAt } })
      await createAuditLog(req.user!.id, 'UPDATE_SHARE_LINK', 'file', file.id, { name: file.name, expiresAt: expiresAt?.toISOString() ?? null })
    }

    return res.status(existingShare ? 200 : 201).json({ url: shareUrl(token!), shareId, expiresAt: expiresAt?.toISOString() ?? null })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/public-permission', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' }, include: { connectedAccount: true } })
    if (file.provider !== 'google_drive') {
      return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive files can be made public.' })
    }
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    await drive.permissions.create({
      fileId: file.providerFileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    })
    await createAuditLog(req.user!.id, 'MAKE_FILE_PUBLIC', 'file', file.id, { name: file.name })
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
    return res.json({ status: 'ok', url: metadata.data.webViewLink ?? metadata.data.webContentLink })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/:id/share', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const revoked = await prisma.fileShare.updateMany({ where: { fileId, userId: req.user!.id, enabled: true }, data: { enabled: false } })
    if (revoked.count > 0) {
      const file = await prisma.file.findFirst({ where: { id: fileId, userId: req.user!.id }, select: { name: true } })
      await createAuditLog(req.user!.id, 'REVOKE_SHARE_LINK', 'file', fileId, { name: file?.name })
    }
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/:id/preview-token', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' } })
    const token = randomToken(32)
    await prisma.filePreviewToken.create({ data: { fileId: file.id, userId: req.user!.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const path = `/files/preview/${token}`
    return res.status(201).json({ path, url: `${req.protocol}://${req.get('host')}${path}` })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/view-url', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    if (file.provider === 's3') return res.json({ url: null })
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    // Returns the owner's Drive link only. Sharing is an explicit action (POST /:id/share or /:id/public-permission).
    const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
    return res.json({ url: metadata.data.webViewLink ?? metadata.data.webContentLink })
  } catch (error) {
    return next(error)
  }
})

fileRouter.get('/:id/download', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id }, include: { connectedAccount: true } })
    return streamProviderFile(file, req.headers.range, res, { disposition: 'attachment' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const fileId = String(req.params.id)
    const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId: req.user!.id, status: 'active' } })
    await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date(), deletedBySync: false } })
    await createAuditLog(req.user!.id, 'TRASH_FILE', 'file', file.id, { name: file.name })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

fileRouter.post('/batch-download', async (req: AuthRequest, res, next) => {
  try {
    const body = batchFileSchema.parse(req.body)
    const files = await prisma.file.findMany({
      where: { id: { in: body.fileIds }, userId: req.user!.id, status: 'active' },
      include: { connectedAccount: true }
    })
    if (files.length === 0) return res.status(404).json({ code: 'FILES_NOT_FOUND', message: 'No files found.' })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="9drive-download.zip"')

    const archive = new ZipArchive({ zlib: { level: 9 } })
    let aborted = false
    let markStopped: () => void = () => undefined
    const stopped = new Promise<void>((resolve) => { markStopped = resolve })
    archive.on('error', (err: Error) => {
      console.error('Zip archive failed:', err)
      aborted = true
      markStopped()
      res.destroy(err)
    })
    res.on('close', () => {
      if (!res.writableFinished) {
        aborted = true
        markStopped()
        archive.abort()
      }
    })
    archive.pipe(res)

    const usedNames = new Map<string, number>()
    const uniqueName = (name: string) => {
      const count = usedNames.get(name) ?? 0
      usedNames.set(name, count + 1)
      if (count === 0) return name
      const dot = name.lastIndexOf('.')
      return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`
    }

    // Open each upstream body only when the archive is ready for it. Opening all of them up
    // front left most bodies idle until they timed out.
    const openFileStream = async (file: (typeof files)[number]): Promise<{ stream: Readable; fileName: string }> => {
      if (file.provider === 's3') {
        const config = await getS3ConfigForAccount(file.connectedAccountId)
        const client = createS3Client(config)
        const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId }))
        return { stream: response.Body as Readable, fileName: file.name }
      }
      const auth = await getAuthedGoogleClient(file.connectedAccount)
      const headers = normalizeHeaders(await auth.getRequestHeaders())
      const exportTarget = googleDownloadExportMimeTypes[file.mimeType]
      const url = exportTarget
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.providerFileId)}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.providerFileId)}?alt=media`
      const response = await fetch(url, { headers })
      if (!response.ok || !response.body) throw new Error(`Google Drive returned ${response.status}`)
      return { stream: Readable.fromWeb(response.body as any), fileName: exportTarget ? withExtension(file.name, exportTarget.extension) : file.name }
    }

    const missing: string[] = []
    for (const file of files) {
      if (aborted) return
      let opened: { stream: Readable; fileName: string }
      try {
        opened = await openFileStream(file)
      } catch (err) {
        console.error(`Failed to add file ${file.name} to zip:`, err)
        missing.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`)
        continue
      }
      if (aborted) {
        opened.stream.destroy()
        return
      }
      const entryWritten = new Promise<void>((resolve) => archive.once('entry', () => resolve()))
      archive.append(opened.stream, { name: uniqueName(opened.fileName.replace(/[\\/]+/g, '-')) })
      await Promise.race([entryWritten, stopped])
    }

    if (aborted) return
    if (missing.length > 0) {
      archive.append(`These files could not be downloaded and are not in this archive:\n\n${missing.join('\n')}\n`, { name: uniqueName('MISSING.txt') })
    }
    await archive.finalize()
  } catch (error) {
    return next(error)
  }
})
