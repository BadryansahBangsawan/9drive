# 9Drive UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 9Drive web app match the approved Light/Dark design (28 frames) and ship the four small backend changes the design needs.

**Architecture:** Semantic color tokens become CSS variables (`:root` / `:root.dark`) exposed to Tailwind v4 via `@theme inline`; every component uses only those tokens. The app shell (sidebar, top bar, upload panel) is split out of `DriveLayout.tsx`; pages are rebuilt on a small set of restyled primitives. Backend changes are additive (optional request fields, extra audit logs, extra response fields, one upload fallback).

**Tech Stack:** React 19, Vite 8, Tailwind 4, lucide-react, cva/clsx/tailwind-merge (frontend); Express 5, Prisma 6, Zod (backend). Pure-logic tests use Node's built-in `node --test` (Node 26 strips TS types natively); no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-ui-redesign-design.md`
**Visual source of truth:** `design/9drive-redesign.figcraft` (open in FigCraft; frame names like `All files — Light`, `Accounts & quota — Dark`). Match spacing/sizes from the frames when the plan is silent.

## Global Constraints

- No new npm dependencies in either package.
- Tokens, exactly: bg, surface, hover, selected, border, text, text-muted, text-subtle, primary, primary-fg, accent, accent-soft, drive, s3, folder, danger — values from the spec's token table.
- No gradients, gradient text, backdrop-blur/glass, colored shadows, `!important` overrides, hard-coded hex colors or `slate-*`/`blue-*`/etc. palette classes in components.
- Font: Inter 400/500/600 (Google Fonts link replaces Manrope). Monospace: `ui-monospace, SFMono-Regular, Menlo, monospace`. Tabular figures for sizes/dates in tables.
- Radii 6 / 8 / 10 / 12–14; button heights 28 / 32 / 36; inputs 36–38; nav 32; rows 44 / 48–52 / 64; icons lucide 16px stroke 1.5.
- Theme: `localStorage['9drive:theme']` = `light | dark | system` (default `system`); `dark` class on `<html>`; applied before first paint.
- Nav labels: All files, Recent, Shared, Trash, (Storage) Accounts & quota, Activity, Settings, API keys. Route paths unchanged.
- Conventions: `@/*` imports, `apiFetch`, `cn`, routes in `App.tsx`, `folderId`/`q` in URL params; backend ESM `.js` import suffixes, Zod validation, JSON errors with `code`/`message`, `createAuditLog`.
- Frontend verification: `cd frontend && npm run build` → tsc passes and Vite prints `✓ built`. The only tolerated error is workbox's `Unable to write the service worker file` (caused by apostrophes in the local path). Backend verification: `cd backend && npm run build`.

## Review Focus

1. Theme set to System and the OS switches light↔dark while the app is open → the app follows immediately; a hard reload never flashes the wrong theme. (Task 5)
2. Very long file names, folder names, and account emails → truncate with ellipsis inside table cells, cards, details panel and upload panel; columns never overflow or wrap the row. (Task 8)
3. A brand-new user (no accounts, no files, no activity, no keys, no shares) → each page shows a short empty state with the next action, never an empty table header. (Tasks 8, 10, 11, 12, 13)
4. A non-admin user → Settings shows no Google sign-in/System update sections and no 403 error text anywhere. (Task 13)
5. Uploading to an S3 account from the browser (automatic routing picks S3, or S3 chosen in the upload dialog) → the file finishes with live progress and appears in the list. (Tasks 4, 9)

---

## File Structure

Backend
- `backend/src/utils/share-expiry.ts` (new): `ShareExpiresIn`, `shareExpiresAt()`.
- `backend/src/utils/account-label.ts` (new): `accountLabel()`.
- `backend/tests/*.test.mjs` (new): node tests against `dist/`.
- `backend/src/modules/files/file.routes.ts`, `invites/invite.routes.ts`, `connected-accounts/connected-account.routes.ts`, `auth/google-login.ts`, `uploads/upload.routes.ts`: audit/expiry/label changes.

Frontend
- `index.html`, `src/style.css`: font, theme bootstrap, tokens.
- `src/lib/theme.ts`, `src/lib/dates.ts`, `src/lib/activity.ts`, `src/lib/accounts.ts` (new, pure where possible) + `frontend/tests/*.test.ts`.
- `src/types/drive.ts` (new): `FileItem`, `FolderItem` moved out of `src/data/drive-data.ts` (deleted at the end).
- `src/components/ui/`: `button.tsx`, `input.tsx`, `card.tsx` (restyled); new `badge.tsx`, `segmented.tsx`, `checkbox.tsx`, `switch.tsx`, `dialog.tsx`, `menu.tsx`, `empty-state.tsx`.
- `src/layouts/DriveLayout.tsx` (thin) + new `src/layouts/shell/Sidebar.tsx`, `Topbar.tsx`, `AvatarMenu.tsx`, `SearchFilters.tsx`, `UploadPanel.tsx`.
- `src/components/drive/`: restyle `FileTable`, `FileGrid`, `FolderGrid`, `FileContextMenu`, `FolderContextMenu`, `EmptyAreaContextMenu`, `PageHeader`, `FileIcon`; new `DetailsPanel.tsx`, `SelectionBar.tsx`, `ShareDialog.tsx`, `UploadDialog.tsx`, `StoredIn.tsx`; delete `DummyModal.tsx`, `FileDetailsDrawer.tsx`, `MetricCard.tsx`, `AvatarStack.tsx` once unused.
- Pages under `src/pages/` rebuilt in place.

---

### Task 1: Backend helpers + test harness

**Files:**
- Create: `backend/src/utils/share-expiry.ts`, `backend/src/utils/account-label.ts`, `backend/tests/helpers.test.mjs`
- Modify: `backend/package.json` (add `"test": "tsc && node --test tests/"`)

**Interfaces:**
- Produces: `type ShareExpiresIn = 'never' | '1d' | '7d' | '30d'`; `shareExpiresAt(expiresIn: ShareExpiresIn, now?: Date): Date | null`; `accountLabel(account: { provider: string; email: string; displayName?: string | null }): string`.

- [ ] **Step 1: Write failing tests** in `backend/tests/helpers.test.mjs` importing from `../dist/utils/*.js`:
  - `shareExpiresAt('never')` → `null`; `shareExpiresAt('1d', new Date('2026-10-31T00:00:00Z'))` → `2026-11-01T00:00:00.000Z`; `'7d'` → `2026-11-07…`; `'30d'` → `2026-11-30…`.
  - `accountLabel({ provider: 'google_drive', email: 'work@example.com' })` → `'Drive · work@example.com'`; `accountLabel({ provider: 's3', email: 'my-bucket (S3)', displayName: 'r2-backup' })` → `'S3 · r2-backup'`; S3 without displayName → `'S3 · my-bucket (S3)'`.
- [ ] **Step 2:** `cd backend && npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement both helpers (no imports from `config/env`, so tests don't need env vars).
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(backend): add share expiry and account label helpers`.

### Task 2: Share expiry + share audit

**Files:** Modify `backend/src/modules/files/file.routes.ts` (`POST /:id/share`, `DELETE /:id/share`).

**Interfaces:**
- Consumes: `shareExpiresAt`, `ShareExpiresIn`.
- Produces: `POST /files/:id/share` body `{ expiresIn?: ShareExpiresIn }` (Zod, default: keep existing expiry, `'never'` for new links); response `{ url, shareId, expiresAt: string | null }`. `GET /files/shared-links` unchanged (already returns `expiresAt`).

- [ ] **Step 1:** Implement: parse body with Zod (`req.body ?? {}`); new link → create with `expiresAt`; existing enabled link + `expiresIn` given → update its `expiresAt`. `createAuditLog(userId, 'CREATE_SHARE_LINK', 'file', file.id, { name, expiresAt })` on create; `'UPDATE_SHARE_LINK'` on expiry change; `DELETE /:id/share` logs `'REVOKE_SHARE_LINK'` only when `count > 0`.
- [ ] **Step 2:** `npm run build` → no errors.
- [ ] **Step 3:** Commit `feat(backend): share link expiry and audit`.

### Task 3: Audit coverage for invites, accounts, uploads

**Files:** Modify `invite.routes.ts`, `connected-account.routes.ts` (Google connect callback, `POST /s3`, `DELETE /:id`), `auth/google-login.ts` (login flow connects an account), `uploads/upload.routes.ts` (multipart Google, multipart S3, resumable completion).

**Interfaces:**
- Consumes: `accountLabel`.
- Produces audit actions (exact strings): `INVITE_SENT`, `INVITE_REVOKED`, `CONNECT_ACCOUNT`, `DISCONNECT_ACCOUNT`, `UPLOAD_FILE`. `UPLOAD_FILE` metadata: `{ name, size, provider, accountLabel }` (size as string). `CONNECT_ACCOUNT`/`DISCONNECT_ACCOUNT` metadata: `{ provider, accountLabel }`, entityType `'account'`. Invite metadata: `{ email, targetType, targetName }`, entityType `'invite'`.

- [ ] **Step 1:** Add the logs. Resumable completion already logs `UPLOAD_FILE`; extend its metadata. `DISCONNECT_ACCOUNT` only when `updateMany.count > 0`. Google connect logs once per callback (create or reconnect).
- [ ] **Step 2:** `npm run build` → no errors.
- [ ] **Step 3:** Commit `feat(backend): audit sharing, invites, accounts and all uploads`.

### Task 4: Upload target label + S3 browser upload path

**Files:** Modify `backend/src/modules/uploads/upload.routes.ts`.

**Interfaces:**
- Produces: `POST /uploads/resumable/init` response adds `accountId: string`, `accountLabel: string` for both providers. For S3 it no longer creates an `uploadSession` row (the multipart path creates its own). `POST /uploads` multipart honors an optional `targetAccountId` text field (sent before the file field); it is passed to `selectAccount` as the target (folder-bound account still wins, as in resumable init).

- [ ] **Step 1:** Implement both changes; keep `responded`/`fail` semantics in `handleUpload`.
- [ ] **Step 2:** `npm run build` → no errors. `npm test` still passes.
- [ ] **Step 3:** Commit `feat(backend): expose upload target and allow targeted multipart uploads`.

### Task 5: Tokens, font, theme

**Files:**
- Modify: `frontend/index.html`, `frontend/src/style.css` (rewrite)
- Create: `frontend/src/lib/theme.ts`, `frontend/tests/theme.test.ts`

**Interfaces:**
- Produces: `type ThemePreference = 'light' | 'dark' | 'system'`; `resolveTheme(pref: ThemePreference, prefersDark: boolean): 'light' | 'dark'`; `getThemePreference(): ThemePreference`; `setThemePreference(pref: ThemePreference): void` (persists + applies); `initTheme(): () => void` (applies, subscribes to `matchMedia('(prefers-color-scheme: dark)')`, returns unsubscribe). Tailwind utilities: `bg-bg`, `bg-surface`, `bg-hover`, `bg-selected`, `border-border`, `text-text`, `text-muted`, `text-subtle`, `bg-primary`, `text-primary-fg`, `text-accent`/`bg-accent`/`ring-accent`, `bg-accent-soft`, `bg-drive`/`text-drive`, `bg-s3`/`text-s3`, `text-folder`, `text-danger`/`bg-danger`/`border-danger` (via `@theme inline` mapping `--color-*` to the CSS vars; `text-muted`/`text-subtle` map to `--text-muted`/`--text-subtle`).

- [ ] **Step 1: Failing test** `frontend/tests/theme.test.ts` (imports `../src/lib/theme.ts`): `resolveTheme('system', true) === 'dark'`, `resolveTheme('system', false) === 'light'`, `resolveTheme('light', true) === 'light'`, `resolveTheme('dark', false) === 'dark'`.
- [ ] **Step 2:** `cd frontend && node --test tests/` → FAIL.
- [ ] **Step 3:** Implement `theme.ts` (browser APIs only inside the non-pure functions, guarded with try/catch for storage). Rewrite `style.css`: `@import "tailwindcss"`, keep `@custom-variant dark`, token vars on `:root` and `:root.dark`, `@theme inline`, base `body { background: var(--bg); color: var(--text); font-family: Inter… }`, `color-scheme` per theme, focus-visible ring using `--accent`. Delete every gradient/glass/`!important` rule. `index.html`: Inter link; inline script before the app that reads `9drive:theme` and sets the `dark` class. Call `initTheme()` in `main.tsx`.
- [ ] **Step 4:** `node --test tests/` → PASS; `npm run build` → passes (see Global Constraints).
- [ ] **Step 5:** Manual (Review Focus 1): with System selected (`localStorage['9drive:theme']='system'`), toggle macOS appearance → app switches without reload; hard reload in each mode shows no flash.
- [ ] **Step 6:** Commit `feat(frontend): design tokens, Inter, light/dark/system theme`.

### Task 6: UI primitives

**Files:** Modify `src/components/ui/button.tsx`, `input.tsx`, `card.tsx`; create `badge.tsx`, `segmented.tsx`, `checkbox.tsx`, `switch.tsx`, `dialog.tsx`, `menu.tsx`, `empty-state.tsx`.

**Interfaces (props):**
- `Button` variants `primary | secondary | ghost | danger | dangerOutline`, sizes `sm (28) | md (32, default) | lg (36) | icon (32 square)`. Keep `default`/`outline` as aliases of `primary`/`secondary` so untouched pages keep compiling until rebuilt.
- `Input` h-9 (36), radius 8; `readOnly` uses `bg-surface`.
- `Card` = `rounded-[10px] border border-border bg-bg`.
- `Badge({ children, tone?: 'neutral' | 'mono' })`; `Segmented<T extends string>({ value, onChange, options: { value: T; label: string }[] })`; `Checkbox({ checked, onChange, 'aria-label' })` 16px; `Switch({ checked, onChange, label })` 34×20; `Dialog({ open, onClose, title, children, footer?, width?: number })` (480 default, scrim `bg-black/45`, Esc + outside click close, focus first field); `Menu({ open, x, y, onClose, children })`, `MenuItem({ icon?, children, shortcut?, danger?, onSelect })`, `MenuSeparator()`; `EmptyState({ icon, title, description, action? })`.

- [ ] **Step 1:** Implement per frames (`Share dialog`, `Context menu`, `Trash` checkbox, `Settings` segmented). Menu/Dialog close on Escape; Menu repositions to stay within the viewport.
- [ ] **Step 2:** `npm run build` → passes.
- [ ] **Step 3:** Commit `feat(frontend): restyled UI primitives`.

### Task 7: App shell

**Files:** Rewrite `src/layouts/DriveLayout.tsx`; create `src/layouts/shell/Sidebar.tsx`, `Topbar.tsx`, `AvatarMenu.tsx`, `SearchFilters.tsx`, `UploadPanel.tsx`; create `src/lib/accounts.ts`.

**Interfaces:**
- Consumes: primitives (Task 6), theme (Task 5).
- Produces: `DriveLayoutContext` unchanged (`setHeaderActions`) plus `setBreadcrumb(items: { label: string; href?: string }[])` and `openUpload()` (opens Task 9's UploadDialog). `accountLabel(account)` mirrors the backend helper.
- Sidebar per spec "App shell"; storage meter split Drive vs S3 from `/connected-accounts` `storageAccount.usedBytes` by provider. Top bar: breadcrumb, search (form submits to existing filter logic moved into `SearchFilters.tsx`; `⌘K`/`Ctrl+K` focuses it), avatar menu (name, email, Light/Dark/System, Sign out). Remove the bell/System info dropdown and photo/video/document breakdown. Mobile < 1024px: menu button opens the sidebar as a drawer.
- `UploadPanel` per the `Context menu + uploads` frame: header "Uploading N of M"/"Upload complete"/"Some uploads failed", collapse, close; per-file row with icon, name (truncate), `size · to <accountLabel>` while uploading, progress bar `bg-accent`, done check `text-drive`, failed text `text-danger` + Retry.

- [ ] **Step 1:** Extend `UploadProgressFile` in `UploadContext.tsx` with `accountLabel?: string` (filled from Task 4's init response).
- [ ] **Step 2:** Implement the shell files.
- [ ] **Step 3:** `npm run build` → passes. Manual: every route renders inside the new shell in both themes; active nav item highlights; drawer works at 375px with no horizontal scroll.
- [ ] **Step 4:** Commit `feat(frontend): new app shell`.

### Task 8: All files (list, grid, details, selection, menus)

**Files:** Modify `src/pages/AllFilesPage.tsx`, `components/drive/FileTable.tsx`, `FileGrid.tsx`, `FolderGrid.tsx`, `FileContextMenu.tsx`, `FolderContextMenu.tsx`, `EmptyAreaContextMenu.tsx`, `PageHeader.tsx`, `FileIcon.tsx`; create `DetailsPanel.tsx`, `SelectionBar.tsx`, `StoredIn.tsx`, `src/types/drive.ts` (move `FileItem`/`FolderItem`, add `accountId?: string`, `accountLabel?: string`; update all imports).

**Interfaces:**
- `StoredIn({ provider, label })` = 6px dot (`bg-drive`/`bg-s3`) + label, truncating.
- `DetailsPanel({ file, folderName, onClose, onCopyLink, onDownload, onMakeDrivePublic? })` 320px; "Make public on Google Drive" only for `google_drive`, behind a confirm Dialog explaining anyone with the Drive link can view.
- `SelectionBar({ count, children })` used by All files (Move to…, Download, Move to Trash) and Trash.
- Row click selects the file for the details panel; checkbox toggles batch selection (checkbox visible on hover or when any selected). Folder size scale controls and colored folder icons go away; folders use the `folder` token color with the existing custom icon when set.

- [ ] **Step 1:** Implement per `All files — Light/Dark` and `All files grid` frames. Breadcrumb via `setBreadcrumb`. Filter chips (Type, Account, Modified) drive the same URL params as `SearchFilters`.
- [ ] **Step 2:** Empty folder / no files → `EmptyState` with Upload + New folder actions (Review Focus 3). Below 1024px the details panel is not docked: the row menu gets "Details", which opens the same panel content in a bottom-sheet `Dialog`; below 768px the table hides Stored in and Modified columns.
- [ ] **Step 3:** `npm run build` → passes. Manual (Review Focus 2): rename a file to a 200-character name and connect an account with a long email → list, grid, details panel and context menu truncate cleanly.
- [ ] **Step 4:** Commit `feat(frontend): redesign All files`.

### Task 9: Dialogs (share, upload, and the rest)

**Files:** Create `components/drive/ShareDialog.tsx`, `UploadDialog.tsx`; modify `AllFilesPage.tsx` (replace every `DummyModal`), `context/UploadContext.tsx`; delete `DummyModal.tsx`.

**Interfaces:**
- `ShareDialog({ file, open, onClose })`: loads/creates link via `POST /files/:id/share`; switch on/off (off = `DELETE /files/:id/share`); expiry select `Never | 1 day | 7 days | 30 days` → `expiresIn`; Copy link; invite email + role (`viewer|editor`) → `POST /invites`; people list from `GET /invites` filtered to this file; footer note exactly "Sharing here doesn’t change who can open the file in Google Drive."
- `UploadDialog({ open, onClose, folderId })`: drop zone + file input, destination folder select, destination account select with first option "Automatic (routing rule)"; submit calls the existing UploadContext entry point with `targetAccountId`.
- UploadContext: when init returns `provider === 's3'`, upload that file with XHR `POST /uploads` multipart (`sizeBytes`, `fileName`, `mimeType`, `folderId`, `targetAccountId=accountId` fields before the `file` field), reporting `upload.onprogress` into the same progress state.
- Rename / Move / New folder / Delete / Invite (folder) / Preview use `Dialog`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npm run build` → passes.
- [ ] **Step 3:** Manual (Review Focus 5): with an S3 account connected, upload via the dialog choosing that account, and once with Automatic while S3 has the most free space → progress moves, file appears with `S3 · …` in Stored in, Activity shows the upload.
- [ ] **Step 4:** Commit `feat(frontend): share and upload dialogs, S3 browser uploads`.

### Task 10: Recent + Activity

**Files:** Create `src/lib/dates.ts`, `src/lib/activity.ts`, `frontend/tests/dates.test.ts`, `frontend/tests/activity.test.ts`; rewrite `pages/RecentPage.tsx`, `pages/ActivityLogPage.tsx`.

**Interfaces:**
- `groupByDay<T>(items: T[], getDate: (item: T) => string, now: Date): { label: string; items: T[] }[]` — labels `Today`, `Yesterday`, then `Earlier this week` (within 7 days), then `Older`; groups in that order, empty groups omitted, items keep input order.
- `activityCategory(action: string): 'uploads' | 'sharing' | 'deleted' | 'other'` — `UPLOAD_FILE`→uploads; `CREATE_SHARE_LINK`, `UPDATE_SHARE_LINK`, `REVOKE_SHARE_LINK`, `MAKE_FILE_PUBLIC`, `INVITE_SENT`, `INVITE_REVOKED`→sharing; `TRASH_FILE`, `PERMANENT_DELETE_FILE`, `DELETE_FOLDER`→deleted; else other.
- `describeActivity(log: { action: string; metadata: string | null }): { verb: string; object: string; suffix?: string }` — e.g. `UPLOAD_FILE` with `{name:'a.png', accountLabel:'S3 · r2'}` → `{ verb: 'Uploaded', object: 'a.png', suffix: 'to S3 · r2' }`; unknown actions → verb from the action in sentence case, object from `metadata.name` or `''`.

- [ ] **Step 1: Failing tests** for the three functions with the examples above, plus: an item dated now−3 days lands in `Earlier this week`; now−10 days in `Older`; `activityCategory('RESTORE_FILE') === 'other'`; metadata `null` doesn't throw.
- [ ] **Step 2:** `node --test tests/` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Rebuild Recent from `GET /files` (last 7 days by `createdAt`, rows "Uploaded HH:mm"/weekday) and Activity (Segmented All/Uploads/Sharing/Deleted, day groups, icon tile per category) per frames; empty states (Review Focus 3).
- [ ] **Step 6:** `npm run build` → passes. Commit `feat(frontend): Recent and Activity on real data`.

### Task 11: Shared + Trash

**Files:** Rewrite `pages/SharedPage.tsx`, `pages/TrashPage.tsx`.

- [ ] **Step 1:** Shared per frame: Public links list (file icon, name, link pill with copy on click, expiry text from `expiresAt` "Never expires"/"Expires Nov 7", Revoke → `DELETE /files/:id/share`) and Invites list (initials avatar, email, `Folder · name`/`File · name`, role Badge, status dot, row menu with Revoke). Empty states.
- [ ] **Step 2:** Trash per frame with Checkbox column, SelectionBar (Restore, Delete permanently in `danger`), "Empty trash" dangerOutline with confirm Dialog; Original location from folder name.
- [ ] **Step 3:** `npm run build` → passes. Commit `feat(frontend): redesign Shared and Trash`.

### Task 12: Accounts & quota + routing

**Files:** Rewrite `pages/QuotaTrackerPage.tsx`; move Connect S3 form + Google connect popup flow here from `SettingsPage.tsx` (Settings keeps no account list).

- [ ] **Step 1:** Implement per frame: header actions, Summary (Used/Free/Total capacity, stacked bar per account, legend), account rows (provider tile, label, email · "synced X ago" from `storageAccount.lastSyncedAt`, usage bar `danger` when ≥85% used, Sync, menu with Disconnect + confirm), Upload routing option cards (`GET`/`PATCH /storage/routing-policy`), priority list with move up/down shown only for `priority`.
- [ ] **Step 2:** No accounts → EmptyState with both connect actions (Review Focus 3).
- [ ] **Step 3:** `npm run build` → passes. Commit `feat(frontend): Accounts & quota with routing`.

### Task 13: Settings + API keys

**Files:** Rewrite `pages/SettingsPage.tsx`, `pages/ApiManagementPage.tsx`.

- [ ] **Step 1:** Settings per frame: 800px column; Profile (avatar initials/gravatar, name, email · role, Sign out); Appearance (`Segmented` bound to `setThemePreference`); Google sign-in and System update sections with Admin Badge rendered only when `user.role === 'admin'`, and their API calls never fired for non-admins (Review Focus 4). Redirect URI stays editable with the server default as placeholder. Update log modal uses `Dialog`.
- [ ] **Step 2:** API keys per frame: Create key Dialog (name, optional expiry), one-time banner with monospace key + Copy, table (Name, Key prefix mono, Scope Badge mono, Last used, Expires, Revoke in `danger`), Quick start curl block using `API_URL`. Empty state.
- [ ] **Step 3:** `npm run build` → passes. Manual: log in as a non-admin → no admin sections, no error text. Commit `feat(frontend): redesign Settings and API keys`.

### Task 14: Auth, public file, remaining pages, cleanup

**Files:** Rewrite `pages/LoginPage.tsx`, `RegisterPage.tsx`, `PublicFilePage.tsx`; restyle `GoogleAuthPage.tsx`, `GoogleConnectedPage.tsx`, `ArchivedPage.tsx`, `StarredPage.tsx` (EmptyState, no dummy data); delete `src/data/drive-data.ts`, `components/drive/FileDetailsDrawer.tsx`, `MetricCard.tsx`, `AvatarStack.tsx`, `src/counter.ts` if present, and any other file left unused.

- [ ] **Step 1:** Login/Register per frames (400px card on `bg-surface`, Google button, divider, form, reCAPTCHA widget placed above submit when configured). Public file per frame (60px bar with Download, preview stage, footer); the embed variant keeps only the preview.
- [ ] **Step 2:** `grep -rnE "slate-|blue-[0-9]|indigo-|emerald-|backdrop-blur|bg-gradient|from-|!important" frontend/src` → no matches outside `style.css` comments.
- [ ] **Step 3:** `npm run build` → passes. Commit `feat(frontend): redesign auth and public pages, remove dummy data`.

### Task 15: Final verification

- [ ] **Step 1:** `cd backend && npm test && npm run build`; `cd frontend && node --test tests/ && npm run build` → all pass.
- [ ] **Step 2:** Run backend + frontend dev servers against a local DB (`npm run prisma:migrate` first). Walk every screen in Light and Dark and compare with the matching frame; check Review Focus 1–5; check 375px width on All files, Accounts, Settings.
- [ ] **Step 3:** Update `README.md` screenshots note only if the screenshots are retaken (optional), and AGENTS.md frontend conventions: tokens instead of palette classes, no `!important`. Commit `docs: frontend design system conventions`.
