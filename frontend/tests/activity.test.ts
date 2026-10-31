import test from 'node:test'
import assert from 'node:assert/strict'
import { activityCategory, describeActivity } from '../src/lib/activity.ts'

test('activityCategory maps actions', () => {
  assert.equal(activityCategory('UPLOAD_FILE'), 'uploads')
  for (const a of ['CREATE_SHARE_LINK', 'UPDATE_SHARE_LINK', 'REVOKE_SHARE_LINK', 'MAKE_FILE_PUBLIC', 'INVITE_SENT', 'INVITE_REVOKED']) {
    assert.equal(activityCategory(a), 'sharing', a)
  }
  for (const a of ['TRASH_FILE', 'PERMANENT_DELETE_FILE', 'DELETE_FOLDER']) assert.equal(activityCategory(a), 'deleted', a)
  assert.equal(activityCategory('RESTORE_FILE'), 'other')
})

test('describeActivity for uploads', () => {
  const r = describeActivity({ action: 'UPLOAD_FILE', metadata: JSON.stringify({ name: 'a.png', accountLabel: 'S3 · r2' }) })
  assert.deepEqual(r, { verb: 'Uploaded', object: 'a.png', suffix: 'to S3 · r2' })
})

test('describeActivity handles null metadata and unknown actions', () => {
  assert.deepEqual(describeActivity({ action: 'UPLOAD_FILE', metadata: null }).verb, 'Uploaded')
  const r = describeActivity({ action: 'SOMETHING_ODD', metadata: null })
  assert.equal(r.verb, 'Something odd')
  assert.equal(r.object, '')
  const r2 = describeActivity({ action: 'SOMETHING_ODD', metadata: '{"name":"x"}' })
  assert.equal(r2.object, 'x')
  assert.doesNotThrow(() => describeActivity({ action: 'TRASH_FILE', metadata: 'not json' }))
})
