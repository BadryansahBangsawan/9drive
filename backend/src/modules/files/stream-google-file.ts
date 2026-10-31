import type { Response } from 'express'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import type { ConnectedAccount, File } from '@prisma/client'
import { getAuthedGoogleClient } from '../google/google.service.js'
import { pipeToResponse, setFileResponseHeaders } from './file-response.js'

type FileWithAccount = File & { connectedAccount: ConnectedAccount }
type StreamOptions = { disposition?: 'inline' | 'attachment' }

export const googleDownloadExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

const googlePreviewExportMimeTypes: Record<string, { mimeType: string; extension: string }> = {
  ...googleDownloadExportMimeTypes,
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/pdf', extension: '.pdf' },
}

export function withExtension(fileName: string, extension: string) {
  return fileName.toLowerCase().endsWith(extension) ? fileName : `${fileName}${extension}`
}

export function normalizeHeaders(headers: Headers | Record<string, string>) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return headers
}

export async function streamGoogleFile(file: FileWithAccount, range: string | undefined, res: Response, options: StreamOptions = {}) {
  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const headers = normalizeHeaders(await auth.getRequestHeaders())
  const exportTarget = (options.disposition === 'inline' ? googlePreviewExportMimeTypes : googleDownloadExportMimeTypes)[file.mimeType]
  const responseMimeType = exportTarget?.mimeType ?? file.mimeType
  const responseFileName = exportTarget ? withExtension(file.name, exportTarget.extension) : file.name
  const url = exportTarget
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.providerFileId)}/export?mimeType=${encodeURIComponent(exportTarget.mimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.providerFileId)}?alt=media`
  const controller = new AbortController()
  res.on('close', () => controller.abort())
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      ...headers,
      ...(range && !exportTarget ? { Range: range } : {}),
    },
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    console.error('Google file stream failed:', response.status, detail)
    const status = response.status === 404 ? 404 : response.status === 416 ? 416 : 502
    return res.status(status).json({ code: 'GOOGLE_FILE_STREAM_FAILED', message: 'Could not read the file from Google Drive.' })
  }

  res.status(response.status)
  setFileResponseHeaders(res, { mimeType: responseMimeType, fileName: responseFileName, disposition: options.disposition })
  res.setHeader('Accept-Ranges', 'bytes')

  const contentLength = response.headers.get('content-length')
  const contentRange = response.headers.get('content-range')
  if (contentLength) res.setHeader('Content-Length', contentLength)
  if (contentRange) res.setHeader('Content-Range', contentRange)

  if (!response.body) {
    res.end()
    return
  }
  return pipeToResponse(response.body as WebReadableStream<Uint8Array>, res)
}
