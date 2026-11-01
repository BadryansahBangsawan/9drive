import Busboy from 'busboy'
import type { NextFunction, Response } from 'express'
import { Router } from 'express'
import { Transform, type Readable } from 'node:stream'
import { z } from 'zod'
import { google } from '../google/google-apis.js'
import type { ConnectedAccount, Folder, UploadSession } from '@prisma/client'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { driveParentForFolder, ensureGoogleAppFolder, getAuthedGoogleClient, syncGoogleQuota } from '../google/google.service.js'
import { abortS3MultipartUpload, buildS3ObjectKey, completeS3MultipartUpload, createS3MultipartUpload, deleteS3Key, getS3ConfigForAccount, isPrivateS3Endpoint, listS3UploadedParts, presignS3UploadParts, syncS3Quota, uploadS3Object } from '../s3/s3.service.js'
import { completedPartsInOrder, s3PartCount, s3PartSize } from '../../utils/s3-multipart.js'
import { createAuditLog } from '../../utils/audit.js'
import { accountLabel } from '../../utils/account-label.js'
import { nextOffsetFromRange } from '../../utils/resumable-range.js'

export const uploadRouter = Router()

type UploadMeta = { fieldName: string; fileName: string; mimeType: string; sizeBytes: bigint; folderId?: string }
type RoutingMode = 'most_available' | 'round_robin' | 'priority'

function auditUpload(userId: string, file: { id: string; name: string }, sizeBytes: bigint, account: { provider: string; email: string; displayName?: string | null }) {
  return createAuditLog(userId, 'UPLOAD_FILE', 'file', file.id, { name: file.name, size: sizeBytes.toString(), provider: account.provider, accountLabel: accountLabel(account) })
}

function logUpload(message: string, metadata?: Record<string, unknown>) {
  console.info('[upload]', message, metadata ?? '')
}

function syncQuotaInBackground(accountId: string, sessionId: string) {
  logUpload('quota sync started', { accountId, sessionId })
  syncGoogleQuota(accountId)
    .then(() => logUpload('quota sync completed', { accountId, sessionId }))
    .catch((error) => logUpload('quota sync failed', { accountId, sessionId, message: error instanceof Error ? error.message : 'Unknown error' }))
}

// Passes a stream through unchanged while counting its bytes.
function countBytes(source: Readable) {
  let bytes = 0n
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += BigInt(chunk.length)
      callback(null, chunk)
    },
  })
  source.on('error', (error) => counter.destroy(error))
  source.pipe(counter)
  return { stream: counter, bytes: () => bytes }
}

function normalizePriorityAccountIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function byPriority<T extends { account: { id: string; createdAt: Date } }>(items: T[], priorityAccountIds: string[]) {
  const order = new Map(priorityAccountIds.map((id, index) => [id, index]))
  return [...items].sort((a, b) => {
    const aOrder = order.get(a.account.id)
    const bOrder = order.get(b.account.id)
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
    if (aOrder !== undefined) return -1
    if (bOrder !== undefined) return 1
    return a.account.createdAt.getTime() - b.account.createdAt.getTime()
  })
}

async function selectAccount(userId: string, sizeBytes: bigint, reservedBytesByAccount = new Map<string, bigint>(), targetAccountId?: string | null) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, provider: { in: ['google_drive', 's3'] }, status: 'connected', ...(targetAccountId ? { id: targetAccountId } : {}) },
    include: { storageAccount: true },
  })

  const stale = accounts.filter((account) => !account.storageAccount?.lastSyncedAt || account.storageAccount.lastSyncedAt.getTime() < Date.now() - 5 * 60_000)
  await Promise.allSettled(stale.map(async (account) => {
    try {
      if (account.provider === 's3') {
        await syncS3Quota(account.id)
      } else {
        await syncGoogleQuota(account.id)
      }
    } catch (err: any) {
      console.error(`[upload] failed to sync quota for account ${account.email} (${account.id}):`, err.message || err)
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { lastError: err.message || 'Quota sync failed' }
      }).catch(() => undefined)
    }
  }))

  const fresh = await prisma.connectedAccount.findMany({
    where: { userId, provider: { in: ['google_drive', 's3'] }, status: 'connected' },
    include: { storageAccount: true },
  })

  const eligible = fresh
    .map((account) => ({ account, availableBytes: account.storageAccount?.availableBytes === null || account.storageAccount?.availableBytes === undefined ? null : account.storageAccount.availableBytes - (reservedBytesByAccount.get(account.id) ?? 0n) }))
    .filter(({ availableBytes }) => availableBytes === null || availableBytes >= sizeBytes)

  if (eligible.length === 0) return null

  if (targetAccountId) {
    const target = eligible.find(e => e.account.id === targetAccountId)
    return target?.account ?? null
  }

  const policy = await prisma.uploadRoutingPolicy.upsert({ where: { userId }, create: { userId, mode: 'most_available', priorityAccountIds: [] }, update: {} })
  const mode = (['most_available', 'round_robin', 'priority'].includes(policy.mode) ? policy.mode : 'most_available') as RoutingMode
  const priorityAccountIds = normalizePriorityAccountIds(policy.priorityAccountIds)

  if (mode === 'priority') return byPriority(eligible, priorityAccountIds)[0]?.account ?? null

  if (mode === 'round_robin') {
    const ordered = byPriority(eligible, priorityAccountIds)
    // Increment atomically so concurrent uploads do not read the same cursor.
    const advanced = await prisma.uploadRoutingPolicy.update({ where: { userId }, data: { roundRobinCursor: { increment: 1 } } })
    return ordered[(advanced.roundRobinCursor - 1) % ordered.length]?.account ?? ordered[0]?.account ?? null
  }

  return eligible
    .sort((a, b) => {
      if (a.availableBytes === null && b.availableBytes === null) return a.account.provider === 's3' ? -1 : 1
      if (a.availableBytes === null) return a.account.provider === 's3' ? -1 : 1
      if (b.availableBytes === null) return b.account.provider === 's3' ? 1 : -1
      return Number(b.availableBytes - a.availableBytes)
    })[0]?.account
}

// Picks the account for an upload. An explicit target (upload dialog) is a hard requirement.
// A folder's bound account is only a preference: folders are app-side, so when that account
// is full the upload falls back to normal routing.
async function selectUploadAccount(userId: string, sizeBytes: bigint, folderId: string | null, explicitAccountId?: string | null, reservedBytesByAccount = new Map<string, bigint>()) {
  const folder = folderId ? await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId, deletedAt: null } }) : null
  if (explicitAccountId) return { folder, account: await selectAccount(userId, sizeBytes, reservedBytesByAccount, explicitAccountId) }
  if (folder?.connectedAccountId) {
    const preferred = await selectAccount(userId, sizeBytes, reservedBytesByAccount, folder.connectedAccountId)
    if (preferred) return { folder, account: preferred }
  }
  return { folder, account: await selectAccount(userId, sizeBytes, reservedBytesByAccount) }
}

// Into the folder's Drive counterpart when it has one on this account (an app folder's mirror under
// 9drive, or an imported My Drive folder); otherwise the account's 9drive folder.
async function driveParentFor(account: ConnectedAccount, folder: Folder | null) {
  return (await driveParentForFolder(account, folder)) ?? ensureGoogleAppFolder(account)
}

export async function handleUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    logUpload('request started', { userId: req.user!.id, contentLength: req.headers['content-length'] })
    const contentType = req.headers['content-type']
    if (!contentType?.includes('multipart/form-data')) return res.status(400).json({ code: 'UPLOAD_INVALID_CONTENT_TYPE', message: 'multipart/form-data required.' })

    const busboy = Busboy({ headers: req.headers, limits: { files: 25, fileSize: env.MAX_UPLOAD_BYTES } })
    const fields: { sizeBytes?: bigint; fileName?: string; mimeType?: string; folderId?: string; targetAccountId?: string } = {}
    let batchMeta: UploadMeta[] | null = null
    let responded = false
    let fileSeen = false
    const reservedBytesByAccount = new Map<string, bigint>()
    const completed: Array<Record<string, unknown>> = []
    const failed: Array<{ fileName: string; code: string; message: string }> = []
    const pendingUploads: Array<Promise<void>> = []

    const fail = async (status: number, code: string, message: string) => {
      if (responded) return
      responded = true
      req.unpipe(busboy)
      req.resume()
      return res.status(status).json({ code, message })
    }

    const batchMetaSchema = z.array(z.object({
      fieldName: z.string().min(1),
      fileName: z.string().min(1).max(255),
      mimeType: z.string().max(255),
      sizeBytes: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
      folderId: z.string().nullable().optional(),
    })).max(25)

    const parseBatchMeta = (value: string): UploadMeta[] => batchMetaSchema.parse(JSON.parse(value)).map((item) => ({
      fieldName: item.fieldName,
      fileName: item.fileName,
      mimeType: item.mimeType || 'application/octet-stream',
      sizeBytes: BigInt(item.sizeBytes),
      folderId: item.folderId ?? undefined,
    }))

    const metaForFile = (fieldName: string, info: { filename: string; mimeType: string }) => {
      if (batchMeta) return batchMeta.find((item) => item.fieldName === fieldName)
      const sizeBytes = fields.sizeBytes
      if (!sizeBytes) return null
      return { fieldName, sizeBytes, fileName: fields.fileName || info.filename, mimeType: fields.mimeType || info.mimeType || 'application/octet-stream', folderId: fields.folderId }
    }

    const uploadOne = async (fieldName: string, fileStream: Readable & { truncated?: boolean }, info: { filename: string; mimeType: string }) => {
      const meta = metaForFile(fieldName, info)
      const fileName = meta?.fileName || info.filename
      let sessionId: string | null = null
      try {
        fileStream.on('limit', () => logUpload('file stream size limit reached', { fileName }))
        if (!meta?.sizeBytes || meta.sizeBytes <= 0n) {
          fileStream.resume()
          failed.push({ fileName, code: 'UPLOAD_SIZE_REQUIRED', message: 'sizeBytes field must be sent before file field.' })
          return
        }
        if (meta.sizeBytes > BigInt(env.MAX_UPLOAD_BYTES)) {
          fileStream.resume()
          failed.push({ fileName, code: 'UPLOAD_TOO_LARGE', message: 'File exceeds max upload size.' })
          return
        }

        const folderId = meta.folderId || null
        const { folder, account } = await selectUploadAccount(req.user!.id, meta.sizeBytes, folderId, fields.targetAccountId, reservedBytesByAccount)
        if (!account) {
          fileStream.resume()
          failed.push({ fileName, code: 'NO_ACCOUNT_WITH_ENOUGH_SPACE', message: 'No connected storage account has enough space for this upload.' })
          return
        }
        reservedBytesByAccount.set(account.id, (reservedBytesByAccount.get(account.id) ?? 0n) + meta.sizeBytes)

        const session = await prisma.uploadSession.create({ data: { userId: req.user!.id, targetConnectedAccountId: account.id, folderId, fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, status: 'uploading' } })
        sessionId = session.id
        logUpload('file upload started', { sessionId: session.id, accountId: account.id, fileName, sizeBytes: meta.sizeBytes.toString() })

        // Stream straight to the provider; nothing is buffered whole in memory or written to disk.
        const counted = countBytes(fileStream)
        const sizeMatches = () => !fileStream.truncated && counted.bytes() === meta.sizeBytes
        const rejectSizeMismatch = async () => {
          await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'failed', errorMessage: 'Streamed byte count did not match declared size.' } })
          failed.push({ fileName, code: 'UPLOAD_SIZE_MISMATCH', message: 'Streamed byte count did not match declared size.' })
        }

        if (account.provider === 's3') {
          const config = await getS3ConfigForAccount(account.id, req.user!.id)
          const provisionalFile = await prisma.file.create({
            data: { userId: req.user!.id, connectedAccountId: account.id, folderId, provider: 's3', providerFileId: 'pending', name: fileName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, status: 'uploading' },
          })
          const providerFileId = buildS3ObjectKey(config, req.user!.id, provisionalFile.id, fileName)
          try {
            await uploadS3Object(config, providerFileId, counted.stream, meta.mimeType)
          } catch (error) {
            await prisma.file.delete({ where: { id: provisionalFile.id } }).catch(() => undefined)
            throw error
          }
          if (!sizeMatches()) {
            await deleteS3Key(config, providerFileId).catch(() => undefined)
            await prisma.file.delete({ where: { id: provisionalFile.id } }).catch(() => undefined)
            return rejectSizeMismatch()
          }
          await prisma.file.update({ where: { id: provisionalFile.id }, data: { providerFileId, status: 'active' } })
          completed.push({ ...provisionalFile, providerFileId, status: 'active', sizeBytes: provisionalFile.sizeBytes.toString() })
          logUpload('s3 upload completed', { sessionId: session.id, accountId: account.id, fileName })
          await auditUpload(req.user!.id, { id: provisionalFile.id, name: fileName }, meta.sizeBytes, account)
        } else {
          const auth = await getAuthedGoogleClient(account)
          const drive = google.drive({ version: 'v3', auth })
          const targetParentId = await driveParentFor(account, folder)
          const uploaded = await drive.files.create({
            requestBody: { name: fileName, parents: [targetParentId] },
            media: { mimeType: meta.mimeType, body: counted.stream },
            fields: 'id,name,mimeType,size',
          })
          const providerFileId = uploaded.data.id ?? ''
          if (!sizeMatches()) {
            if (providerFileId) await drive.files.delete({ fileId: providerFileId }).catch(() => undefined)
            return rejectSizeMismatch()
          }
          logUpload('google upload completed', { sessionId: session.id, accountId: account.id, fileName })
          const file = await prisma.file.create({ data: { userId: req.user!.id, connectedAccountId: account.id, folderId, provider: 'google_drive', providerFileId, name: uploaded.data.name ?? fileName, mimeType: uploaded.data.mimeType ?? meta.mimeType, sizeBytes: meta.sizeBytes } })
          logUpload('database file created', { sessionId: session.id, fileId: file.id, accountId: account.id })
          completed.push({ ...file, sizeBytes: file.sizeBytes.toString() })
          await auditUpload(req.user!.id, file, meta.sizeBytes, account)
        }

        await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'completed', completedAt: new Date() } })
        if (account.provider === 's3') syncS3Quota(account.id).catch(() => undefined)
        else syncQuotaInBackground(account.id, session.id)
      } catch (error) {
        // Drain whatever is left so busboy can move on to the next part.
        fileStream.unpipe()
        fileStream.resume()
        const message = error instanceof Error ? error.message : 'Upload failed'
        logUpload('file upload failed', { fileName, message })
        if (sessionId) await prisma.uploadSession.update({ where: { id: sessionId }, data: { status: 'failed', errorMessage: message.slice(0, 1000) } }).catch(() => undefined)
        failed.push({ fileName, code: 'UPLOAD_FAILED', message: 'Upload failed.' })
      }
    }

    busboy.on('field', (name, value) => {
      try {
        if (name === 'sizeBytes') fields.sizeBytes = BigInt(z.string().regex(/^\d+$/).parse(value.trim()))
        if (name === 'fileName') fields.fileName = value
        if (name === 'mimeType') fields.mimeType = value
        if (name === 'folderId') fields.folderId = value
        if (name === 'targetAccountId') fields.targetAccountId = value
        if (name === 'filesMeta') batchMeta = parseBatchMeta(value)
      } catch {
        void fail(400, 'UPLOAD_INVALID_METADATA', 'Upload metadata is invalid.')
      }
    })

    busboy.on('file', (name, fileStream, info) => {
      if (responded) {
        fileStream.resume()
        return
      }
      fileSeen = true
      pendingUploads.push(uploadOne(name, fileStream, info))
    })

    busboy.on('error', (error) => {
      logUpload('multipart parser failed', { message: error instanceof Error ? error.message : 'Unknown error' })
      if (!responded) {
        responded = true
        next(error)
      }
    })

    busboy.on('finish', () => {
      if (!responded && !fileSeen) return fail(400, 'UPLOAD_FILE_REQUIRED', 'file field required.')
      Promise.all(pendingUploads).then(() => {
        if (responded) return
        responded = true
        logUpload('response sent', { completed: completed.length, failed: failed.length })
        if (completed.length === 0) return res.status(400).json({ code: failed[0]?.code ?? 'UPLOAD_FAILED', message: failed[0]?.message ?? 'Upload failed', failed })
        if (!batchMeta && completed.length === 1 && failed.length === 0) return res.status(201).json({ file: completed[0] })
        return res.status(201).json({ files: completed, failed })
      }).catch(next)
    })

    req.pipe(busboy)
  } catch (error) {
    return next(error)
  }
}

uploadRouter.post('/', requireAuth, handleUpload)

type DriveFileResource = { id: string; name?: string; mimeType?: string }

// Records a finished resumable Drive upload: the File row (once), the session, audit and quota.
// Called from the last chunk and from /resumable/status, whichever learns of completion first.
async function finalizeResumableUpload(session: UploadSession, account: ConnectedAccount, fileMeta: DriveFileResource) {
  let file = await prisma.file.findFirst({ where: { providerFileId: fileMeta.id, userId: session.userId } })
  if (!file) {
    file = await prisma.file.create({
      data: {
        userId: session.userId,
        connectedAccountId: account.id,
        folderId: session.folderId,
        provider: 'google_drive',
        providerFileId: fileMeta.id,
        name: fileMeta.name || session.fileName,
        mimeType: fileMeta.mimeType || session.mimeType,
        sizeBytes: session.sizeBytes,
      },
    })
  }
  if (session.status !== 'completed') {
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'completed', completedAt: new Date() } })
    await auditUpload(session.userId, file, file.sizeBytes, account)
    syncQuotaInBackground(account.id, session.id)
  }
  return file
}

// Resumable upload endpoints

// 1. Initialize resumable session
uploadRouter.post('/resumable/init', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      fileName: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.string().trim().regex(/^\d+$/, 'sizeBytes must be a whole number of bytes.'),
      folderId: z.string().nullable().optional(),
      targetAccountId: z.string().nullable().optional(),
      // Desktop app: it sends the bytes straight to Google (session URI) or S3 (presigned parts).
      direct: z.boolean().optional(),
    }).parse(req.body)

    const sizeBytes = BigInt(body.sizeBytes)
    if (sizeBytes <= 0n) return res.status(400).json({ code: 'UPLOAD_SIZE_REQUIRED', message: 'Valid sizeBytes required.' })
    if (sizeBytes > BigInt(env.MAX_UPLOAD_BYTES)) return res.status(400).json({ code: 'UPLOAD_TOO_LARGE', message: 'File exceeds max upload size.' })

    const folderId = body.folderId || null
    const { folder, account } = await selectUploadAccount(req.user!.id, sizeBytes, folderId, body.targetAccountId)
    if (!account) return res.status(400).json({ code: 'NO_ACCOUNT_WITH_ENOUGH_SPACE', message: 'No connected storage account has enough space.' })

    if (account.provider === 's3') {
      const config = await getS3ConfigForAccount(account.id, req.user!.id)
      // Without `direct`, or for a bucket on a private network the client may not reach, S3 uploads
      // go through the multipart endpoint (POST /uploads), which creates its own session.
      if (!body.direct || (config.endpoint && await isPrivateS3Endpoint(config.endpoint))) {
        return res.status(201).json({ provider: account.provider, direct: false, accountId: account.id, accountLabel: accountLabel(account), offset: 0 })
      }
      const session = await prisma.uploadSession.create({
        data: { userId: req.user!.id, targetConnectedAccountId: account.id, folderId, fileName: body.fileName, mimeType: body.mimeType, sizeBytes, status: 'uploading', provider: 's3' },
      })
      const objectKey = buildS3ObjectKey(config, req.user!.id, session.id, body.fileName)
      const s3UploadId = await createS3MultipartUpload(config, objectKey, body.mimeType)
      await prisma.uploadSession.update({ where: { id: session.id }, data: { objectKey, s3UploadId } })
      const partSize = s3PartSize(sizeBytes)
      return res.status(201).json({ provider: 's3', direct: true, sessionId: session.id, partSize, partCount: s3PartCount(sizeBytes, partSize), accountId: account.id, accountLabel: accountLabel(account), offset: 0 })
    }
    if (account.provider !== 'google_drive') return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'This account type cannot take uploads.' })

    const auth = await getAuthedGoogleClient(account)
    const targetParentId = await driveParentFor(account, folder)

    // Initiate Google Drive Resumable Session
    const headers = new Headers()
    const token = await auth.getAccessToken()
    headers.set('Authorization', `Bearer ${token.token}`)
    headers.set('Content-Type', 'application/json')
    headers.set('X-Upload-Content-Type', body.mimeType)
    headers.set('X-Upload-Content-Length', sizeBytes.toString())

    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: body.fileName,
        parents: [targetParentId]
      })
    })

    if (!initRes.ok) {
      console.error('Google resumable init failed:', initRes.status, await initRes.text())
      return res.status(502).json({ code: 'UPLOAD_INIT_FAILED', message: 'Google Drive could not start the upload.' })
    }

    const sessionUri = initRes.headers.get('location')
    if (!sessionUri) throw new Error('Google API did not return Location header.')

    const session = await prisma.uploadSession.create({
      data: {
        userId: req.user!.id,
        targetConnectedAccountId: account.id,
        folderId,
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes,
        status: 'uploading',
        googleSessionUri: sessionUri
      }
    })

    // The session URI lets whoever holds it upload this one file (no Google token needed), so it
    // goes only to the client that asked for a direct upload, and is never logged.
    return res.status(201).json({ sessionId: session.id, provider: 'google_drive', direct: Boolean(body.direct), ...(body.direct ? { uploadUrl: sessionUri } : {}), accountId: account.id, accountLabel: accountLabel(account), offset: 0 })
  } catch (error) {
    return next(error)
  }
})

// 2. Query/Resume resumable status
uploadRouter.get('/resumable/status/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { id: String(req.params.id), userId: req.user!.id }
    })

    if (session.status === 'completed') {
      return res.json({ status: 'completed', offset: session.sizeBytes.toString() })
    }

    if (!session.googleSessionUri || !session.targetConnectedAccountId) {
      return res.json({ status: 'uploading', offset: '0' })
    }

    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: session.targetConnectedAccountId, userId: req.user!.id }
    })
    const auth = await getAuthedGoogleClient(account)
    const token = await auth.getAccessToken()

    // Query Google Drive for uploaded offset
    const queryHeaders = new Headers()
    queryHeaders.set('Authorization', `Bearer ${token.token}`)
    queryHeaders.set('Content-Range', `bytes */${session.sizeBytes}`)

    const queryRes = await fetch(session.googleSessionUri, {
      method: 'PUT',
      headers: queryHeaders
    })

    if (queryRes.status === 308) {
      return res.json({ status: 'uploading', offset: nextOffsetFromRange(queryRes.headers.get('range')).toString() })
    } else if (queryRes.ok) {
      // Google finished the upload but the client never got the last chunk's answer (dropped
      // connection, proxy error). Record the file now, or it would be "done" yet missing.
      await finalizeResumableUpload(session, account, await queryRes.json() as DriveFileResource)
      return res.json({ status: 'completed', offset: session.sizeBytes.toString() })
    }

    return res.json({ status: 'uploading', offset: '0' })
  } catch (error) {
    return res.json({ status: 'failed', offset: '0' })
  }
})

// 3. Upload chunk
uploadRouter.put('/resumable/chunk/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { id: String(req.params.id), userId: req.user!.id }
    })

    const rangeHeader = req.headers['content-range']
    if (!rangeHeader || typeof rangeHeader !== 'string') {
      return res.status(400).json({ code: 'MISSING_CONTENT_RANGE', message: 'Content-Range header is required.' })
    }

    // Parse Content-Range, e.g. bytes 0-5242879/10485760
    const match = rangeHeader.match(/bytes\s+(\d+)-(\d+)\/(\d+)/)
    if (!match) return res.status(400).json({ code: 'INVALID_CONTENT_RANGE', message: 'Invalid Content-Range format.' })

    const startByte = BigInt(match[1])
    const endByte = BigInt(match[2])
    const totalBytes = BigInt(match[3])
    // The total was fixed (and checked against quota/max size) at init; don't let a chunk change it.
    if (totalBytes !== session.sizeBytes || startByte > endByte || endByte >= totalBytes) {
      return res.status(400).json({ code: 'INVALID_CONTENT_RANGE', message: 'Content-Range does not match this upload session.' })
    }

    if (!session.googleSessionUri || !session.targetConnectedAccountId) {
      return res.status(400).json({ code: 'UNSUPPORTED_PROVIDER', message: 'Only Google Drive resumable uploads supported.' })
    }

    const account = await prisma.connectedAccount.findFirstOrThrow({
      where: { id: session.targetConnectedAccountId, userId: req.user!.id }
    })
    const auth = await getAuthedGoogleClient(account)
    const token = await auth.getAccessToken()

    // Stream chunk body from client to Google Drive resumable URI
    const putHeaders = new Headers()
    putHeaders.set('Authorization', `Bearer ${token.token}`)
    putHeaders.set('Content-Range', rangeHeader)
    putHeaders.set('Content-Length', (endByte - startByte + 1n).toString())

    const putRes = await fetch(session.googleSessionUri, {
      method: 'PUT',
      headers: putHeaders,
      body: req as any,
      duplex: 'half'
    } as any)

    if (putRes.status === 308) {
      // Google may persist only part of the chunk; resume from what it actually stored.
      return res.json({ status: 'uploading', offset: nextOffsetFromRange(putRes.headers.get('range')).toString() })
    }

    if (putRes.ok) {
      const file = await finalizeResumableUpload(session, account, await putRes.json() as DriveFileResource)
      return res.status(201).json({ status: 'completed', file: { ...file, sizeBytes: file.sizeBytes.toString() } })
    }

    const errorMsg = await putRes.text()
    console.error('Resumable chunk upload failed:', putRes.status, errorMsg)
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'failed', errorMessage: errorMsg.slice(0, 1000) }
    })

    return res.status(putRes.status >= 500 ? 502 : putRes.status).json({ code: 'UPLOAD_FAILED', message: 'Google Drive rejected the upload chunk.' })
  } catch (error) {
    return next(error)
  }
})

// Cancels an upload session: aborts an S3 multipart upload, or tells Google to drop the resumable
// session, and marks it cancelled. A completed session is left alone.
uploadRouter.delete('/resumable/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const session = await prisma.uploadSession.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } })
    if (!session) return res.status(404).json({ code: 'UPLOAD_SESSION_NOT_FOUND', message: 'Upload session not found.' })
    if (session.status === 'completed') return res.json({ status: 'completed' })
    if (session.provider === 's3' && session.s3UploadId && session.objectKey && session.targetConnectedAccountId) {
      const config = await getS3ConfigForAccount(session.targetConnectedAccountId, req.user!.id)
      await abortS3MultipartUpload(config, session.objectKey, session.s3UploadId).catch(() => undefined)
    } else if (session.googleSessionUri) {
      await fetch(session.googleSessionUri, { method: 'DELETE' }).catch(() => undefined)
    }
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'cancelled' } })
    return res.json({ status: 'cancelled' })
  } catch (error) {
    return next(error)
  }
})

// ---- Direct S3 multipart uploads (desktop app) ----

async function loadS3Session(req: AuthRequest) {
  const session = await prisma.uploadSession.findFirst({ where: { id: String(req.params.id), userId: req.user!.id, provider: 's3' } })
  if (!session?.s3UploadId || !session.objectKey || !session.targetConnectedAccountId) return null
  const config = await getS3ConfigForAccount(session.targetConnectedAccountId, req.user!.id)
  return { session, config, objectKey: session.objectKey, uploadId: session.s3UploadId }
}

const sessionNotFound = (res: Response) => res.status(404).json({ code: 'UPLOAD_SESSION_NOT_FOUND', message: 'Upload session not found.' })

// Presigned PUT URLs for some parts (valid for an hour; the client asks again for later parts).
uploadRouter.post('/s3/:id/part-urls', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100) }).parse(req.body)
    const loaded = await loadS3Session(req)
    if (!loaded) return sessionNotFound(res)
    if (loaded.session.status !== 'uploading') return res.status(409).json({ code: 'UPLOAD_SESSION_CLOSED', message: `This upload is ${loaded.session.status}.` })
    const expected = s3PartCount(loaded.session.sizeBytes, s3PartSize(loaded.session.sizeBytes))
    if (body.partNumbers.some((n) => n > expected)) return res.status(400).json({ code: 'INVALID_PART_NUMBER', message: `This upload has ${expected} parts.` })
    return res.json({ urls: await presignS3UploadParts(loaded.config, loaded.objectKey, loaded.uploadId, [...new Set(body.partNumbers)]) })
  } catch (error) {
    return next(error)
  }
})

// Parts S3 already has, for resuming after a restart.
uploadRouter.get('/s3/:id/parts', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const loaded = await loadS3Session(req)
    if (!loaded) return sessionNotFound(res)
    if (loaded.session.status === 'completed') return res.json({ status: 'completed', parts: [] })
    return res.json({ status: loaded.session.status, parts: await listS3UploadedParts(loaded.config, loaded.objectKey, loaded.uploadId) })
  } catch (error) {
    return next(error)
  }
})

// Finishes the upload: S3 assembles the parts, the object's size is checked against the session,
// and the File row is created.
uploadRouter.post('/s3/:id/complete', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(255) })).min(1).max(10_000) }).parse(req.body)
    const loaded = await loadS3Session(req)
    if (!loaded) return sessionNotFound(res)
    const { session, config, objectKey, uploadId } = loaded
    const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: session.targetConnectedAccountId!, userId: req.user!.id } })

    if (session.status === 'completed') {
      const existing = await prisma.file.findFirst({ where: { userId: req.user!.id, provider: 's3', providerFileId: objectKey } })
      if (existing) return res.json({ status: 'completed', file: { ...existing, sizeBytes: existing.sizeBytes.toString() } })
    }
    if (session.status !== 'uploading') return res.status(409).json({ code: 'UPLOAD_SESSION_CLOSED', message: `This upload is ${session.status}.` })

    const parts = completedPartsInOrder(body.parts, s3PartCount(session.sizeBytes, s3PartSize(session.sizeBytes)))
    if (!parts) return res.status(400).json({ code: 'INVALID_PARTS', message: 'Every part must be listed once, with its ETag.' })

    // Claim the session so two complete calls can't both create the File row.
    const claimed = await prisma.uploadSession.updateMany({ where: { id: session.id, status: 'uploading' }, data: { status: 'completing' } })
    if (claimed.count === 0) return res.status(409).json({ code: 'UPLOAD_SESSION_CLOSED', message: 'This upload is already being completed.' })
    let storedBytes: bigint
    try {
      storedBytes = await completeS3MultipartUpload(config, objectKey, uploadId, parts)
    } catch (error) {
      await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'uploading' } })
      throw error
    }
    if (storedBytes !== session.sizeBytes) {
      await deleteS3Key(config, objectKey).catch(() => undefined)
      await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'failed', errorMessage: `Stored ${storedBytes} bytes, expected ${session.sizeBytes}.` } })
      return res.status(400).json({ code: 'UPLOAD_SIZE_MISMATCH', message: 'The uploaded file is not the size that was announced.' })
    }

    const file = await prisma.file.create({
      data: { userId: req.user!.id, connectedAccountId: account.id, folderId: session.folderId, provider: 's3', providerFileId: objectKey, name: session.fileName, mimeType: session.mimeType, sizeBytes: session.sizeBytes, status: 'active' },
    })
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'completed', completedAt: new Date() } })
    await auditUpload(req.user!.id, file, file.sizeBytes, account)
    syncS3Quota(account.id).catch(() => undefined)
    return res.status(201).json({ status: 'completed', file: { ...file, sizeBytes: file.sizeBytes.toString() } })
  } catch (error) {
    return next(error)
  }
})
