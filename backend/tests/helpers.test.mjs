import test from 'node:test'
import assert from 'node:assert/strict'
import { shareExpiresAt } from '../dist/utils/share-expiry.js'
import { accountLabel } from '../dist/utils/account-label.js'
import { nextOffsetFromRange } from '../dist/utils/resumable-range.js'

const now = new Date('2026-10-31T00:00:00Z')

test('shareExpiresAt never returns null', () => {
  assert.equal(shareExpiresAt('never'), null)
})

test('shareExpiresAt adds days', () => {
  assert.equal(shareExpiresAt('1d', now).toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(shareExpiresAt('7d', now).toISOString(), '2026-11-07T00:00:00.000Z')
  assert.equal(shareExpiresAt('30d', now).toISOString(), '2026-11-30T00:00:00.000Z')
})

test('accountLabel formats drive and s3', () => {
  assert.equal(accountLabel({ provider: 'google_drive', email: 'work@example.com' }), 'Drive · work@example.com')
  assert.equal(accountLabel({ provider: 's3', email: 'my-bucket (S3)', displayName: 'r2-backup' }), 'S3 · r2-backup')
  assert.equal(accountLabel({ provider: 's3', email: 'my-bucket (S3)' }), 'S3 · my-bucket (S3)')
})

test('nextOffsetFromRange uses the last persisted byte', () => {
  assert.equal(nextOffsetFromRange('bytes=0-4194303'), 4194304n)
  assert.equal(nextOffsetFromRange('bytes=0-0'), 1n)
  assert.equal(nextOffsetFromRange(null), 0n)
  assert.equal(nextOffsetFromRange(undefined), 0n)
  assert.equal(nextOffsetFromRange('garbage'), 0n)
})

import { s3PartSize, s3PartCount, completedPartsInOrder, S3_DEFAULT_PART_BYTES } from '../dist/utils/s3-multipart.js'
import { oauthReturnUrl } from '../dist/utils/oauth-return.js'

test('s3PartSize keeps 64 MiB until a file needs more than 10,000 parts', () => {
  const MiB = 1024n * 1024n
  assert.equal(s3PartSize(1n), S3_DEFAULT_PART_BYTES)
  assert.equal(s3PartSize(640_000n * MiB), S3_DEFAULT_PART_BYTES)
  const huge = 1024n * 1024n * MiB   // 1 TiB
  const part = s3PartSize(huge)
  assert.equal(part % (1024 * 1024), 0)
  assert.ok(s3PartCount(huge, part) <= 10_000)
  assert.equal(s3PartCount(100n * MiB, S3_DEFAULT_PART_BYTES), 2)
  assert.equal(s3PartCount(64n * MiB, S3_DEFAULT_PART_BYTES), 1)
})

test('completedPartsInOrder wants every part once, with an ETag', () => {
  assert.deepEqual(completedPartsInOrder([{ partNumber: 2, etag: 'b' }, { partNumber: 1, etag: 'a' }], 2).map((p) => p.partNumber), [1, 2])
  assert.equal(completedPartsInOrder([{ partNumber: 1, etag: 'a' }], 2), null)
  assert.equal(completedPartsInOrder([{ partNumber: 1, etag: 'a' }, { partNumber: 1, etag: 'a' }], 2), null)
  assert.equal(completedPartsInOrder([{ partNumber: 1, etag: '' }], 1), null)
})

test('oauthReturnUrl sends desktop flows to /desktop-return with the ninedrive:// link in the fragment', () => {
  assert.equal(oauthReturnUrl('https://drive.example', 'desktop', 'google-auth', { token: 'abc' }), `https://drive.example/desktop-return#${encodeURIComponent('ninedrive://google-auth?token=abc')}`)
  assert.match(oauthReturnUrl('https://drive.example', 'web', 'google-connected', { status: 'success' }), /^https:\/\/drive\.example\/google-connected\?status=success$/)
})

import { thumbnailExpiry, thumbnailPath, thumbnailSignature, verifyThumbnailSignature, mayHaveThumbnail } from '../dist/utils/thumbnail.js'

test('thumbnail URLs are signed, stable within a window, and expire', () => {
  const now = Date.UTC(2026, 10, 1, 7, 0, 0)
  const exp = thumbnailExpiry(now)
  assert.equal(thumbnailExpiry(now + 60_000), exp, 'same URL for a while, so browsers can cache it')
  assert.ok(exp > now)
  const sig = thumbnailSignature('secret', 'file-1', exp)
  assert.ok(verifyThumbnailSignature('secret', 'file-1', exp, sig, now))
  assert.equal(verifyThumbnailSignature('secret', 'file-2', exp, sig, now), false, 'bound to the file')
  assert.equal(verifyThumbnailSignature('other', 'file-1', exp, sig, now), false, 'bound to the key')
  assert.equal(verifyThumbnailSignature('secret', 'file-1', exp, sig, exp + 1), false, 'expires')
  assert.equal(verifyThumbnailSignature('secret', 'file-1', exp, 'zz', now), false)
})

test('mayHaveThumbnail: Drive renders documents and media, S3 only small images', () => {
  const file = (provider, mimeType, sizeBytes = 10n) => ({ id: 'f', provider, mimeType, sizeBytes })
  assert.ok(mayHaveThumbnail(file('google_drive', 'video/mp4')))
  assert.ok(mayHaveThumbnail(file('google_drive', 'application/vnd.google-apps.document')))
  assert.ok(mayHaveThumbnail(file('google_drive', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')))
  assert.equal(mayHaveThumbnail(file('google_drive', 'application/zip')), false)
  assert.ok(mayHaveThumbnail(file('s3', 'image/png')))
  assert.equal(mayHaveThumbnail(file('s3', 'image/png', 100n * 1024n * 1024n)), false)
  assert.equal(mayHaveThumbnail(file('s3', 'video/mp4')), false)
  assert.equal(thumbnailPath('k', file('s3', 'application/zip')), null)
  assert.match(thumbnailPath('k', file('google_drive', 'image/jpeg')), /^\/files\/thumbnail\/f\?exp=\d+&sig=[0-9a-f]{64}$/)
})
