// Integration test for the Google Drive import (dist/modules/google/drive-sync.js) against a real
// MySQL/MariaDB database and an in-memory fake Drive. Skipped unless DRIVE_SYNC_TEST_DATABASE_URL
// points at a scratch database (it is wiped). Run after `npx tsc` and `prisma migrate deploy` on it:
//
//   DATABASE_URL=$DRIVE_SYNC_TEST_DATABASE_URL npx prisma migrate deploy
//   DRIVE_SYNC_TEST_DATABASE_URL=... node --test --experimental-test-module-mocks tests/drive-sync.integration.test.mjs
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

const DB = process.env.DRIVE_SYNC_TEST_DATABASE_URL
const skip = !DB && 'DRIVE_SYNC_TEST_DATABASE_URL not set'

const FOLDER = 'application/vnd.google-apps.folder'
const MY_DRIVE = 'root-id'
const APP = 'app-id'

// ---- Fake Drive: items plus a changes feed ----
const drive = {
  items: new Map(),
  changes: [],
  reset() {
    this.items = new Map()
    this.changes = []
    this.put({ id: APP, name: '9drive', mimeType: FOLDER, parents: [MY_DRIVE] })
  },
  put(item) {
    const full = { ownedByMe: true, trashed: false, size: item.mimeType === FOLDER ? undefined : '10', createdTime: '2026-01-01T00:00:00Z', ...this.items.get(item.id), ...item }
    this.items.set(item.id, full)
    this.changes.push({ fileId: item.id, removed: false, file: { ...full } })
  },
  trash(id) { this.put({ id, trashed: true }) },
  api: {
    files: {
      get: async ({ fileId }) => ({ data: { id: fileId === 'root' ? MY_DRIVE : fileId } }),
      list: async ({ q }) => {
        const folders = q.startsWith(`mimeType = '${FOLDER}'`)
        const files = [...drive.items.values()].filter((i) => !i.trashed && i.ownedByMe && (i.mimeType === FOLDER) === folders)
        return { data: { files: files.map((f) => ({ ...f })), nextPageToken: null } }
      },
    },
    changes: {
      getStartPageToken: async () => ({ data: { startPageToken: String(drive.changes.length) } }),
      list: async ({ pageToken }) => {
        if (pageToken === 'bad') throw Object.assign(new Error('Invalid page token'), { response: { status: 404 } })
        return { data: { changes: drive.changes.slice(Number(pageToken)), newStartPageToken: String(drive.changes.length) } }
      },
    },
  },
}

let sync, prisma, user, account

test.before(async () => {
  if (skip) return
  process.env.DATABASE_URL = DB
  mock.module(new URL('../dist/modules/google/google.service.js', import.meta.url).href, {
    namedExports: {
      ensureGoogleAppFolder: async () => APP,
      getAuthedGoogleClient: async () => ({}),
      syncGoogleQuota: async () => undefined,
      googleDriveFolderMimeType: FOLDER,
    },
  })
  mock.module(new URL('../dist/modules/google/google-apis.js', import.meta.url).href, {
    namedExports: { google: { drive: () => drive.api } },
  })
  sync = await import('../dist/modules/google/drive-sync.js')
  prisma = (await import('../dist/config/prisma.js')).prisma
})

test.after(async () => { if (!skip) await prisma.$disconnect() })

async function fresh() {
  for (const t of ['workspaceInvite', 'fileShare', 'file', 'folder', 'storageAccount', 'connectedAccount', 'user']) await prisma[t].deleteMany({})
  drive.reset()
  user = await prisma.user.create({ data: { name: 'T', email: 't@example.com', passwordHash: 'x' } })
  account = await prisma.connectedAccount.create({ data: { userId: user.id, provider: 'google_drive', providerAccountId: 'g1', email: 'me@example.com', scopes: [], status: 'connected' } })
}
const run = (opts) => sync.syncGoogleDrive(account.id, user.id, opts)
const folderByDrive = (id) => prisma.folder.findFirst({ where: { providerFolderId: id } })
const fileByDrive = (id) => prisma.file.findFirst({ where: { providerFileId: id } })

function seedDrive() {
  drive.put({ id: 'A', name: 'Alpha', mimeType: FOLDER, parents: [MY_DRIVE] })
  drive.put({ id: 'B', name: 'Beta', mimeType: FOLDER, parents: ['A'] })
  drive.put({ id: 'a1', name: 'a1.txt', mimeType: 'text/plain', parents: ['A'] })
  drive.put({ id: 'b1', name: 'b1.txt', mimeType: 'text/plain', parents: ['B'] })
  drive.put({ id: 'r1', name: 'r1.txt', mimeType: 'text/plain', parents: [MY_DRIVE] })
  drive.put({ id: 'X', name: 'Uploads', mimeType: FOLDER, parents: [APP] })
  drive.put({ id: 'u1', name: 'u1.txt', mimeType: 'text/plain', parents: [APP] })
  drive.put({ id: 'x1', name: 'x1.txt', mimeType: 'text/plain', parents: ['X'] })
  drive.put({ id: 'form', name: 'Survey', mimeType: 'application/vnd.google-apps.form', parents: [MY_DRIVE] })
  drive.put({ id: 'shared', name: 'theirs.txt', mimeType: 'text/plain', parents: [MY_DRIVE], ownedByMe: false })
}

test('full import mirrors My Drive under the account folder and the 9drive folder at the app root', { skip }, async () => {
  await fresh(); seedDrive()
  const result = await run()
  assert.equal(result.mode, 'full')
  const root = await prisma.folder.findFirst({ where: { source: 'drive_root' } })
  assert.equal(root.name, 'Drive · me@example.com')
  assert.equal(root.providerFolderId, MY_DRIVE)
  const A = await folderByDrive('A'), B = await folderByDrive('B'), X = await folderByDrive('X')
  assert.deepEqual([A.parentId, A.source], [root.id, 'drive'])
  assert.deepEqual([B.parentId, B.source], [A.id, 'drive'])
  assert.deepEqual([X.parentId, X.source], [null, 'app'])
  assert.equal((await fileByDrive('a1')).folderId, A.id)
  assert.equal((await fileByDrive('b1')).folderId, B.id)
  assert.equal((await fileByDrive('r1')).folderId, root.id)
  assert.equal((await fileByDrive('u1')).folderId, null)
  assert.equal((await fileByDrive('x1')).folderId, X.id)
  assert.equal(await fileByDrive('form'), null, 'non-exportable Google types are skipped')
  assert.equal(await fileByDrive('shared'), null, 'not owned: not part of My Drive')
  assert.equal((await fileByDrive('a1')).createdAt.toISOString(), '2026-01-01T00:00:00.000Z', 'keeps the Drive creation date')
  const again = await run({ full: true })
  assert.deepEqual([again.created, again.updated, again.deleted], [0, 0, 0], 'a second full import changes nothing')
})

test('a folder trashed in Drive comes back with its files when restored in Drive', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  drive.trash('A'); drive.put({ id: 'a1', trashed: true }); drive.put({ id: 'B', trashed: true }); drive.put({ id: 'b1', trashed: true })
  await run({ full: true })
  let A = await folderByDrive('A')
  assert.ok(A.deletedAt && A.deletedBySync)
  assert.deepEqual([(await fileByDrive('a1')).status, (await fileByDrive('a1')).deletedBySync], ['deleted', true])
  for (const id of ['A', 'a1', 'B', 'b1']) drive.put({ id, trashed: false })
  await run({ full: true })
  A = await folderByDrive('A')
  assert.equal(A.deletedAt, null)
  assert.equal((await fileByDrive('a1')).status, 'active')
  assert.equal((await fileByDrive('b1')).folderId, (await folderByDrive('B')).id)
})

test('what the user deleted in 9drive stays out, and new Drive files inside it are not imported', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  const B = await folderByDrive('B')
  await prisma.folder.update({ where: { id: B.id }, data: { deletedAt: new Date(), deletedBySync: false } })
  await prisma.file.updateMany({ where: { folderId: B.id }, data: { status: 'deleted', deletedAt: new Date(), deletedBySync: false } })
  drive.put({ id: 'b2', name: 'b2.txt', mimeType: 'text/plain', parents: ['B'] })
  await run({ full: true })
  assert.ok((await folderByDrive('B')).deletedAt)
  assert.equal((await fileByDrive('b1')).status, 'deleted')
  assert.equal(await fileByDrive('b2'), null)
  // The user restores b1 from the app Trash: it is a normal file again.
  await prisma.file.updateMany({ where: { providerFileId: 'b1' }, data: { status: 'active', deletedAt: null, folderId: null } })
  await run({ full: true })
  assert.equal((await fileByDrive('b1')).status, 'active')
})

test('rows edited in 9drive during a sync are not overwritten with stale Drive data', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  const A = await folderByDrive('A')
  const future = new Date(Date.now() + 60 * 60_000)
  await prisma.$executeRaw`UPDATE folders SET name = 'Renamed in app', updated_at = ${future} WHERE id = ${A.id}`
  await prisma.$executeRaw`UPDATE files SET name = 'renamed.txt', updated_at = ${future} WHERE provider_file_id = 'r1'`
  drive.put({ id: 'A', name: 'Alpha (stale)' })
  drive.put({ id: 'r1', trashed: true })
  await run({ full: true })
  assert.equal((await folderByDrive('A')).name, 'Renamed in app')
  const r1 = await fileByDrive('r1')
  assert.deepEqual([r1.name, r1.status], ['renamed.txt', 'active'], 'not renamed back, not deleted')
})

test('a folder whose parent has no Drive mirror keeps its app-side parent', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  const P = await prisma.folder.create({ data: { userId: user.id, name: 'No mirror', source: 'app' } })
  const C = await folderByDrive('X')
  await prisma.folder.update({ where: { id: C.id }, data: { parentId: P.id } })
  await run({ full: true })
  assert.equal((await folderByDrive('X')).parentId, P.id)
})

test('incremental sync applies the changes feed: new, renamed, moved, trashed, and child-before-parent', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  const root = await prisma.folder.findFirst({ where: { source: 'drive_root' } })
  drive.put({ id: 'n2', name: 'n2.txt', mimeType: 'text/plain', parents: ['N'] })   // file before its new folder
  drive.put({ id: 'N', name: 'New', mimeType: FOLDER, parents: ['A'] })
  drive.put({ id: 'r1', name: 'r1-renamed.txt' })
  drive.put({ id: 'a1', parents: [MY_DRIVE] })
  drive.trash('b1')
  drive.put({ id: 'C2', name: 'Child', mimeType: FOLDER, parents: ['P2'] })        // folder before its new parent
  drive.put({ id: 'P2', name: 'Parent', mimeType: FOLDER, parents: [MY_DRIVE] })
  const result = await run()
  assert.equal(result.mode, 'incremental')
  const N = await folderByDrive('N')
  assert.equal(N.parentId, (await folderByDrive('A')).id)
  assert.equal((await fileByDrive('n2')).folderId, N.id)
  assert.equal((await fileByDrive('r1')).name, 'r1-renamed.txt')
  assert.equal((await fileByDrive('a1')).folderId, root.id)
  assert.deepEqual([(await fileByDrive('b1')).status, (await fileByDrive('b1')).deletedBySync], ['deleted', true])
  assert.equal((await folderByDrive('C2')).parentId, (await folderByDrive('P2')).id)
  const quiet = await run()
  assert.deepEqual([quiet.mode, quiet.created, quiet.updated, quiet.deleted], ['incremental', 0, 0, 0])
})

test('a rejected changes token falls back to a full import', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  await prisma.connectedAccount.update({ where: { id: account.id }, data: { driveChangesToken: 'bad' } })
  drive.put({ id: 'late', name: 'late.txt', mimeType: 'text/plain', parents: [MY_DRIVE] })
  const result = await run()
  assert.equal(result.mode, 'full')
  assert.ok(await fileByDrive('late'))
  assert.notEqual((await prisma.connectedAccount.findUnique({ where: { id: account.id } })).driveChangesToken, 'bad')
})

test('removing the import drops the Drive tree but keeps files uploaded through 9drive', { skip }, async () => {
  await fresh(); seedDrive(); await run()
  await sync.removeImportedDrive(user.id, account.id)
  assert.equal(await prisma.folder.count({ where: { source: { in: ['drive', 'drive_root'] } } }), 0)
  for (const id of ['a1', 'b1', 'r1']) assert.equal(await fileByDrive(id), null)
  assert.ok(await fileByDrive('u1'))
  assert.ok(await fileByDrive('x1'))
  assert.ok(await folderByDrive('X'))
  const acct = await prisma.connectedAccount.findUnique({ where: { id: account.id } })
  assert.equal(acct.driveChangesToken, null)
})
