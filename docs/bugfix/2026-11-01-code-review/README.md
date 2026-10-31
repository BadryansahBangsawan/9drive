# Bug fix backlog — code review 2026-11-01

**Status (2026-11-01): all 13 items fixed** on branch `fix/code-review-2026-11-01` (commits `7621ea0`..`427a852`, one commit per item), merged into `main`. Kept as a record.

Source: `/code-review medium` scanning the whole codebase on `main` at `1f1c8e8` (after the UI redesign merge). Findings are **unverified**: no second pass, nothing run. Verify each one before changing code.

## How to start the next session

Paste this into a fresh Claude Code session from the repo root:

> Read `docs/bugfix/2026-11-01-code-review/README.md`. Create branch `fix/code-review-2026-11-01` from `main`. For items 1–6 in order: confirm the bug exists from the code (and say so if it doesn't), fix it with the smallest change, run `cd backend && npm test && npm run build` and `cd frontend && node --test tests/ && npm run build`, and commit each fix separately. Then ask me before doing items 7–13.

Verification notes: there is no local DB or browser. The frontend `npm run build` passes when tsc is clean and Vite prints `✓ built`; it then fails writing the PWA service worker only because the repo path contains apostrophes (`Badry's SSD`) — that error is tolerated. Backend tests: `node --test` against `dist/`; frontend tests: `node --test tests/` (Node 26 strips TS types).

## Fix first (1–6)

1. **Resumable chunk offset ignores Google's `Range` header** — `backend/src/modules/uploads/upload.routes.ts:512`
   On a 308 the handler returns `endByte + 1` as the next offset. Google may persist only part of a chunk (e.g. `Range: bytes=0-4194303` for a 5 MiB chunk). The client then skips bytes and the Drive file is corrupt or rejected. Fix: parse `range` from the 308 response (as `/resumable/status` already does) and return `lastByte + 1`; no `Range` header means offset 0.

2. **Resumable chunk PUT has no 401 token refresh** — `frontend/src/context/UploadContext.tsx:130`
   Chunks use raw `fetch` with `getAccessToken()`. Uploads longer than `ACCESS_TOKEN_TTL_SECONDS` (default 900 s) fail mid-way with "Chunk upload failed". The S3 multipart XHR path already retries once after `refreshAccessToken()` (exported from `frontend/src/lib/api.ts`); do the same for chunk PUTs and the status GET. If refresh fails, behave like `apiFetch` (clear session).

3. **Google sync undoes in-app moves** — `backend/src/modules/google/google.service.ts:156`
   `PATCH /files/:id` and `PATCH /files/batch` only change `File.folderId` in MySQL; the Drive file stays in its old Drive folder, so the next `POST /files/sync-google` resets `folderId` from the Drive parent. Fix options: (a) also move the Drive file (`files.update` with `addParents`/`removeParents`) when the target folder has a `providerFolderId` on the same account, or (b) stop sync from overwriting `folderId` for existing rows. Prefer (a) for Drive files on the same account; fall back to (b) behavior otherwise. Decide and document.

4. **PWA service worker serves `index.html` for `/api/*` navigations in production** — `frontend/vite.config.ts:29`
   `navigateFallbackDenylist` lists bare backend prefixes, but production `API_URL` is `/api`. PDF preview iframes (`/api/files/preview/<token>`) and public download links (`/api/public/files/<token>/download`) get the SPA shell. Fix: add `/^\/api\//` to the denylist (keep the existing entries for dev).

5. **Share tokens stored in plaintext next to the hash** — `backend/src/modules/files/file.routes.ts:302`, `backend/src/modules/public/public.routes.ts:11`
   `FileShare.token` holds the raw token and `findSharedFile` matches on it. AGENTS.md requires share tokens stored as hashes. Fix: stop writing `token` for new links; look up by `tokenHash` only (keep accepting `token` matches for existing rows until migrated, or migrate: hash existing tokens into `tokenHash` and null `token`). The UI needs the URL only at creation time — return it from `POST /files/:id/share`; `GET /files/shared-links` must then stop exposing raw URLs for old links (show "Copy" only right after creating, or re-issue a link). This changes UX on the Shared page — check with the owner before shipping.

6. **Folder-bound account overrides routing and fallback** — `backend/src/modules/uploads/upload.routes.ts:194` and `:353`
   Uploads into a folder are forced to `folder.connectedAccountId`; when that account is full every folder upload fails with `NO_ACCOUNT_WITH_ENOUGH_SPACE` although other accounts have space. Folders are virtual (app-side), so the account binding should be a preference, not a hard requirement: try the folder's account first, otherwise fall back to normal routing (respecting an explicit `targetAccountId` from the upload dialog).

## Then (7–13), ask the owner first

7. **Old share rows with `token = null` produce `/public/files/undefined`** — `file.routes.ts:311`. `POST /files/:id/share` reuses an existing enabled row even when `token` is null. Ties into item 5.
8. **Drive sync query grows without bound** — `google.service.ts:127`. ORs `'id' in parents` for every folder ever created on the account (deleted ones too); hundreds of folders exceed Drive's query length → sync fails with 400. Chunk the parent list into several queries.
9. **`PATCH /files/:id` needs a working Google client even for DB-only moves, and edits trashed files** — `file.routes.ts:278`. Only build the Drive client when renaming a Drive file; add `status: 'active'`.
10. **Batch zip opens every upstream stream up front** — `file.routes.ts:461`. Up to 100 idle bodies; later ones time out and are silently skipped (line 462). Open each stream lazily as archiver reaches it, and report skipped files (e.g. a `MISSING.txt` in the zip).
11. **Bad numeric input returns 500** — `upload.routes.ts:345` (`BigInt(body.sizeBytes)` on non-numeric) and `file.routes.ts:68` (`BigInt` on fractional `minSize`/`maxSize`). Validate with Zod (`/^\d+$/`, `.int()`).
12. **Resumable chunk trusts the client's `Content-Range` total** — the chunk handler records `sizeBytes` from the header without comparing to `session.sizeBytes`. Reject mismatches.
13. **Upload retry state keyed by file name** — `UploadContext.tsx`. Two files with the same name clobber each other's resumable session. Key by a per-upload id.

## Context

- Repo: `github.com/BadryansahBangsawan/9drive` (`origin`), upstream `zenhosta/9drive` (`upstream`).
- `main` is 29 commits ahead of `origin/main` and **not pushed yet**.
- The UI redesign spec/plan: `docs/superpowers/specs/2026-10-31-ui-redesign-design.md`, `docs/superpowers/plans/2026-10-31-ui-redesign.md`.
- Still outstanding from the redesign: run `cd backend && npm run prisma:migrate` (role + emailVerifiedAt migration), and a manual browser walk of every screen in Light and Dark (System theme switching, long names/emails, empty new account, non-admin user, S3 upload from the browser, 375px width).
