import { createHmac, timingSafeEqual } from 'node:crypto'

// Thumbnail URLs go in <img src>, which can't send the bearer token, so each one carries an HMAC
// signature over the file id and an expiry. The expiry is rounded to 6-hour windows: the URL stays
// the same for hours, so browsers can cache the image instead of asking again on every list load.
const WINDOW_MS = 6 * 60 * 60_000

export function thumbnailExpiry(now = Date.now()) {
  return (Math.floor(now / WINDOW_MS) + 2) * WINDOW_MS
}

export function thumbnailSignature(secret: string, fileId: string, expiresAt: number) {
  return createHmac('sha256', secret).update(`thumbnail:${fileId}:${expiresAt}`).digest('hex')
}

export function verifyThumbnailSignature(secret: string, fileId: string, expiresAt: number, signature: string, now = Date.now()) {
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 3 * WINDOW_MS) return false
  if (!/^[0-9a-f]{64}$/.test(signature)) return false
  const expected = Buffer.from(thumbnailSignature(secret, fileId, expiresAt), 'hex')
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

const DRIVE_THUMBNAIL_TYPES = [
  /^image\//, /^video\//, /^application\/pdf$/,
  /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/,
  /^application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
]
const S3_IMAGE_TYPES = /^image\/(jpeg|png|gif|webp|avif|bmp)$/
const S3_MAX_THUMBNAIL_BYTES = 15n * 1024n * 1024n

// Google Drive renders thumbnails for images, videos, PDFs and office/Google documents. S3 has none:
// small images are shown as they are; everything else keeps its icon.
export function mayHaveThumbnail(file: { provider: string; mimeType: string; sizeBytes: bigint }) {
  if (file.provider === 'google_drive') return DRIVE_THUMBNAIL_TYPES.some((pattern) => pattern.test(file.mimeType))
  if (file.provider === 's3') return S3_IMAGE_TYPES.test(file.mimeType) && file.sizeBytes <= S3_MAX_THUMBNAIL_BYTES
  return false
}

export function thumbnailPath(secret: string, file: { id: string; provider: string; mimeType: string; sizeBytes: bigint }, now = Date.now()) {
  if (!mayHaveThumbnail(file)) return null
  const expiresAt = thumbnailExpiry(now)
  return `/files/thumbnail/${file.id}?exp=${expiresAt}&sig=${thumbnailSignature(secret, file.id, expiresAt)}`
}
