import test from 'node:test'
import assert from 'node:assert/strict'
import { shareExpiresAt } from '../dist/utils/share-expiry.js'
import { accountLabel } from '../dist/utils/account-label.js'

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
