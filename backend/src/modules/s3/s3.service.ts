import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { ConnectedAccount, File, S3StorageConfig } from '@prisma/client'
import type { Response } from 'express'
import type { Readable } from 'node:stream'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../middleware/error.middleware.js'
import { decryptText } from '../../utils/crypto.js'
import { pipeToResponse, setFileResponseHeaders } from '../files/file-response.js'

type S3Config = S3StorageConfig
type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

const privateRanges = new net.BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) privateRanges.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) privateRanges.addSubnet(address, prefix, 'ipv6')

function isPrivateAddress(address: string) {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address
  if (net.isIPv4(mapped)) return privateRanges.check(mapped, 'ipv4')
  return privateRanges.check(mapped, 'ipv6')
}

// Blocks user-supplied S3 endpoints that point at the server's own network (SSRF), unless explicitly allowed.
export async function assertSafeS3Endpoint(endpoint: string) {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'S3_ENDPOINT_INVALID', 'S3 endpoint must be an http(s) URL.')
  if (env.S3_ALLOW_PRIVATE_ENDPOINTS) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address)
  if (addresses.length === 0) throw new HttpError(400, 'S3_ENDPOINT_UNRESOLVED', 'S3 endpoint host could not be resolved.')
  if (addresses.some(isPrivateAddress)) throw new HttpError(400, 'S3_ENDPOINT_NOT_ALLOWED', 'S3 endpoint points to a private network address. Set S3_ALLOW_PRIVATE_ENDPOINTS=true to allow it.')
}

export function createS3Client(config: S3Config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint ?? undefined,
    forcePathStyle: config.forcePathStyle || Boolean(config.endpoint),
    credentials: {
      accessKeyId: decryptText(config.accessKeyIdEncrypted),
      secretAccessKey: decryptText(config.secretAccessKeyEncrypted),
    },
  })
}

export async function getS3ConfigForAccount(accountId: string, userId?: string) {
  return prisma.s3StorageConfig.findFirstOrThrow({ where: { connectedAccountId: accountId, status: 'active', ...(userId ? { userId } : {}) } })
}

export async function testS3Connection(config: S3Config) {
  const client = createS3Client(config)
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
}

function safeFileName(name: string) {
  return name.replace(/[\\/]+/g, '-').replace(/[\u0000-\u001f\u007f]+/g, '').slice(0, 180) || 'file'
}

export function buildS3ObjectKey(config: Pick<S3Config, 'prefix'>, userId: string, fileId: string, fileName: string) {
  return `${config.prefix.replace(/^\/+|\/+$/g, '')}/${userId}/${fileId}/${safeFileName(fileName)}`
}

export async function uploadS3Object(config: S3Config, key: string, body: NodeJS.ReadableStream, mimeType: string) {
  const client = createS3Client(config)
  await new Upload({
    client,
    params: { Bucket: config.bucket, Key: key, Body: body as Readable, ContentType: mimeType },
  }).done()
}

export async function deleteS3Key(config: S3Config, key: string) {
  const client = createS3Client(config)
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
}

export async function deleteS3Object(file: FileWithAccount) {
  const config = await getS3ConfigForAccount(file.connectedAccountId)
  await deleteS3Key(config, file.providerFileId)
}

export async function syncS3Quota(accountId: string) {
  const config = await getS3ConfigForAccount(accountId)
  const client = createS3Client(config)
  let usedBytes = 0n
  let continuationToken: string | undefined
  // Count only objects under this app's prefix, not unrelated data that shares the bucket.
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '')
  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix ? `${prefix}/` : undefined, ContinuationToken: continuationToken }))
    for (const object of response.Contents ?? []) usedBytes += BigInt(object.Size ?? 0)
    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return prisma.storageAccount.upsert({
    where: { connectedAccountId: accountId },
    create: {
      connectedAccountId: accountId,
      totalBytes: config.quotaBytes,
      usedBytes,
      availableBytes: config.quotaBytes === null ? null : config.quotaBytes - usedBytes,
      lastSyncedAt: new Date(),
    },
    update: {
      totalBytes: config.quotaBytes,
      usedBytes,
      availableBytes: config.quotaBytes === null ? null : config.quotaBytes - usedBytes,
      lastSyncedAt: new Date(),
    },
  })
}

export async function streamS3File(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  const config = await getS3ConfigForAccount(file.connectedAccountId)
  const client = createS3Client(config)
  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: file.providerFileId, Range: range }))

  res.status(response.ContentRange ? 206 : 200)
  setFileResponseHeaders(res, { mimeType: response.ContentType ?? file.mimeType, fileName: file.name, disposition: options.disposition })
  res.setHeader('Accept-Ranges', 'bytes')
  if (response.ContentLength !== undefined) res.setHeader('Content-Length', response.ContentLength.toString())
  if (response.ContentRange) res.setHeader('Content-Range', response.ContentRange)

  const body = response.Body as Readable | undefined
  if (!body) return res.end()
  return pipeToResponse(body, res)
}
