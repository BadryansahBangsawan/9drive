import type { Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

type Disposition = 'inline' | 'attachment'

// Types a browser would execute as a document on our origin. These are never served as-is.
const activeContentTypes = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/xsl',
  'application/xslt+xml',
  'application/javascript',
  'text/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-shockwave-flash',
])

const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i

function baseMimeType(mimeType: string) {
  return mimeType.split(';')[0]!.trim().toLowerCase()
}

export function isActiveContentType(mimeType: string) {
  const base = baseMimeType(mimeType)
  return activeContentTypes.has(base) || base.endsWith('+xml')
}

export function contentDisposition(type: Disposition, fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '') || 'file'
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

// Sets Content-Type/Disposition for a stored file so user-uploaded content can never run as a page on our origin.
export function setFileResponseHeaders(res: Response, { mimeType, fileName, disposition }: { mimeType: string; fileName: string; disposition?: Disposition }) {
  const base = baseMimeType(mimeType)
  const active = isActiveContentType(base)
  const safeType = active || !mimeTypePattern.test(base) ? 'application/octet-stream' : base
  res.setHeader('Content-Type', safeType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const effectiveDisposition = active ? 'attachment' : disposition
  if (effectiveDisposition) res.setHeader('Content-Disposition', contentDisposition(effectiveDisposition, fileName))
}

// Streams a provider body to the client with backpressure; aborts the upstream when the client goes away.
export async function pipeToResponse(body: Readable | WebReadableStream<Uint8Array>, res: Response) {
  const source = body instanceof Readable ? body : Readable.fromWeb(body)
  try {
    await pipeline(source, res)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('File stream failed:', error)
  }
}
