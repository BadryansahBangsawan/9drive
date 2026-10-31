# 9Drive UI redesign: design

Date: 2026-10-31
Status: approved design, ready for planning
Source of truth for visuals: `design/9drive-redesign.figcraft` (FigCraft; also exported as `design/9drive-redesign.fig` for OpenPencil/Figma). 28 frames: 14 screens, each in Light and Dark.

## Why

The owner's complaints about the current UI: dark mode looks bad, the whole thing reads as generic "AI slop" (glass cards, radial gradients, gradient text, colored shadows, heavy rounded pills), and the layout is unclear. The goal is a modern, clean, clearly structured interface. Direction "A" was chosen from Mobbin references (Skiff Drive, Proton Drive, Google Drive dark): calm, lots of whitespace, plain tables instead of cards, near-black dark mode with thin borders. One borrowed element from Vapi: a right-hand details panel, because it can show which Drive/S3 account a file lives in, which is what makes 9Drive different.

## Goals

- Every authenticated page and the auth/public pages match the design frames in layout, spacing, type, and color, in both themes.
- Dark mode is a first-class theme driven by the same semantic tokens as light, not an afterthought.
- The UI makes 9Drive's core idea visible: files live in different storage accounts, and the user can always see which one.
- Existing behavior keeps working: uploads (including resumable), folders, search and filters, preview, share, invites, trash/restore/permanent delete, sync, quota, API keys, Google OAuth config, system update, routing policy.

## Non-goals

- No backend changes beyond the small set listed in "Backend changes (approved)".
- No new product features beyond what the frames show. Starred stays out of the nav (it is disabled today).
- No dedicated mobile design. Mobile must stay usable (see "Responsive"), but there are no mobile frames to match.

## Anti-goals (a failure even if it "works")

- Any gradient backgrounds, gradient text, glassmorphism/backdrop-blur, or colored glow shadows.
- Styling by overriding Tailwind utilities with `!important` (what `style.css` does today).
- Hard-coded hex colors or `slate-*`/`blue-*` palette classes in components. Components use the semantic tokens only.
- Inconsistent radii/heights: one button height per size, one input height, one row height per table type.

## Design system (decided)

### Tokens

Exactly these semantic color tokens, values exported from the design file:

| token | Light | Dark | use |
|---|---|---|---|
| bg | #FFFFFF | #0E0E10 | page/main background, inputs, cards |
| surface | #F7F7F8 | #141416 | sidebar, preview wells, code blocks, read-only inputs |
| hover | #F0F0F2 | #1B1B1E | row/menu hover |
| selected | #EBEBEE | #232327 | active nav item, active segmented tab, progress track |
| border | #E6E6E9 | #242428 | all 1px borders and dividers |
| text | #18181B | #EDEDEF | primary text |
| text-muted | #6B6B73 | #9A9AA2 | secondary text, default icon color |
| text-subtle | #A0A0A8 | #65656D | column headers, section labels, placeholders |
| primary | #18181B | #EDEDEF | primary button background (near-black in light, near-white in dark) |
| primary-fg | #FFFFFF | #0E0E10 | text/icons on primary |
| accent | #2563EB | #6B9BF2 | focus ring, selection outline, progress fill, links-as-state |
| accent-soft | #EEF3FE | #151C2A | selected row/card background, info banners |
| drive | #1E9E5A | #3DBE7A | Google Drive account dot/bar |
| s3 | #D9731F | #F0954A | S3 account dot/bar |
| folder | #8A8A93 | #7A7A83 | folder glyph |
| danger | #DC2626 | #F87171 | destructive actions, near-full quota bar |

Implement as CSS custom properties on `:root` with dark overrides on `:root.dark`, exposed to Tailwind v4 through `@theme inline` so classes like `bg-surface`, `text-text-muted`, `border-border` work. The builder may pick friendlier utility names as long as the mapping to these tokens is one-to-one.

### Theme switching

Three choices: Light, Dark, System (default). Stored in `localStorage['9drive:theme']` as `light|dark|system`; System follows `prefers-color-scheme` live. The `dark` class on `<html>` stays the switch, so the existing `@custom-variant dark` keeps working. Apply the class before first paint (inline script in `index.html`) to avoid a flash. The control lives in Settings → Appearance (segmented control), plus a quick toggle in the avatar menu.

### Type

Inter (replace Manrope in the Google Fonts link), weights 400/500/600. Scale used by the frames: 11 (section labels, kbd), 12 (meta, column headers), 13 (body, buttons, rows), 14 (panel titles), 15–16 (brand, details title), 20–22 (page titles, letter-spacing -1.5%), 24 (stat numbers). Sizes and dates in tables use tabular figures. Code/API keys use a monospace stack (`ui-monospace, SFMono-Regular, Menlo, monospace`).

### Shape and spacing

- Radius: 6 (nav items, chips, small buttons), 8 (buttons, inputs), 10 (tables, panels, cards), 12–14 (popovers, dialogs, auth card).
- Heights: buttons 32 (default) / 36 (prominent, e.g. sidebar Upload, dialog actions) / 28 (row actions); inputs 36–38; nav items 32; list rows 44 (file table), 48–52 (grouped lists), 64 (account rows).
- Shadows only on floating layers (menus, upload panel, dialogs, auth card): soft neutral black shadows, never colored.
- Icons: lucide-react at 16px, stroke 1.5, default color `text-muted`, `text` when active, `primary-fg` on primary buttons.

## App shell (decided)

- Sidebar, 248px, `surface` background, right border:
  brand (logo square + "9Drive") → primary **Upload** button (full width) → nav: All files, Recent, Shared, Trash → section label "Storage" → Accounts & quota, Activity → flexible space → Settings, API keys → storage meter (percent, two-color bar Drive/S3 by usage share, "X of Y · N accounts").
- Top bar, 56px, bottom border: breadcrumb on the left (current folder path on All files, page name elsewhere), search field (320px, `⌘K` hint, opens the existing advanced filters), avatar on the right with a menu (name/email, theme, sign out).
- Content area: 28px padding; page header = title (22px semibold) + one-line description, actions right-aligned.
- Remove from the shell: the "Workspace Status & Info" bell dropdown (it describes SQLite, which is wrong for this MySQL app) and the photo/video/document breakdown list.
- Labels change: "Quota Tracker" → "Accounts & quota", "Shared With Me" → "Shared", "Recycle Bin" → "Trash", "Activity Log" → "Activity", "Setting" → "Settings". Route paths stay the same.

## Screens (decided; match the frames)

1. **All files, list**: page header with folder name + "New folder"; toolbar with filter chips (Type, Account, Modified) and list/grid toggle; table columns Name (icon + name), Stored in (provider dot + "Drive · <account>" / "S3 · <account>"), Size (right-aligned), Modified, row menu. Selected row uses `accent-soft`. Right **details panel** (320px) for the selected file: preview well, name, type · size, info rows (Stored in, Account, Folder, Modified, Sharing), primary "Copy share link", secondary "Download". Panel can be closed; nothing selected = no panel.
2. **All files, grid**: "Folders" row of compact folder cards, then "Files" grid of cards (thumb well 120px + name + "size · provider · account"). Selected card: 1.5px `accent` border, `accent-soft` thumb.
3. **Recent**: grouped lists Today / Yesterday / Earlier this week, rows show name, location, and time.
4. **Shared**: "Public links" list (file, link pill, expiry, Revoke) and "Invites" list (avatar initials, email, target, role badge, status dot Accepted/Pending, row menu).
5. **Trash**: header with "Empty trash" (danger outline); a selection bar appears when rows are checked ("N selected", Restore, Delete permanently); table with checkbox, Name, Original location, Size, Deleted.
6. **Accounts & quota**: header actions "Connect S3" (secondary) and "Connect Google Drive" (primary); summary panel with Used / Free / Total capacity and a stacked bar + legend per account; account rows (provider tile, name, email · last synced, usage bar with "X of Y", Sync, row menu); account bar turns `danger` at ≥85% used. "Upload routing" as three selectable option cards (Most free space / Round robin / Priority order).
7. **Activity**: segmented filter (All, Uploads, Sharing, Deleted); grouped by day; each event = icon tile + sentence with the object name in medium weight + time.
8. **Settings**: single 800px column of sections (label column 240px + control): Profile (avatar, name, email · role, Sign out), Appearance (Light/Dark/System), Google sign-in (Admin badge; Client ID, Client secret "Saved — leave blank to keep it", Redirect URI read-only + hint, Save), System update (Admin badge, "Update now"). Admin-only sections render only for admins, as today.
9. **API keys**: header "Create key"; one-time "copy your new key" banner (`accent-soft`) with monospace field + Copy; table Name, Key prefix (mono), Scope badge, Last used, Expires, Revoke (danger text); "Quick start" curl block.
10. **Login / Register**: centered 400px card on `surface` page: logo, title + subtitle, "Continue with Google", "or" divider, form, full-width primary submit, footer link. Register adds Name and the password hint. reCAPTCHA keeps working when configured.
11. **Public file page**: 60px top bar (file type tile, name, "size · shared <date>", primary Download), centered preview stage on `surface`, footer "Shared with 9Drive".
12. **Overlays**: context menu (Preview, Download, Share…, Rename, Move to…, Move to Trash in `danger`; separators; hover = `hover`); upload panel bottom-right 360px (header "Uploading N of M", per-file rows with done check in `drive`, progress bar in `accent`, waiting state); share dialog 480px (public link switch, link field + Copy link, expiry select, invite email + role + Invite, people list, footer note "Sharing here doesn't change who can open the file in Google Drive.").

Pages not in the frames (Archived, Starred placeholder, Google auth/connected handoff pages, empty states, loading and error states) use the same tokens and components; their exact look is left to the builder.

## Data sources (decided)

- All files, Trash, Shared, API keys, Settings, Accounts: existing endpoints already used by these pages.
- Details panel "Stored in"/"Account": `file.connectedAccount` (`provider`, `email`) is already returned by `GET /files` and `GET /files/:id`. Label format: `Drive · <email>` or `S3 · <bucket label>`.
- Recent: today it renders dummy data from `src/data/drive-data.ts`. Replace with real data from `GET /files`, filtered client-side to the last 7 days by `createdAt` and grouped by day. The backend does not track "opened", so rows say "Uploaded <time>" only. Delete the dummy data module if nothing else uses it.
- Activity: `GET /audit-logs` (last 100). Filters are client-side by action (UPLOAD_* → Uploads; SHARE/PUBLIC/INVITE → Sharing; TRASH/DELETE → Deleted).
- Upload routing: `GET`/`PATCH /storage/routing-policy` (`mode`: `most_available | round_robin | priority`). Priority order editing beyond choosing the mode is out of scope.
- Sidebar storage meter: `GET /storage/summary` plus `GET /connected-accounts` for the Drive/S3 split.

## Backend changes (approved by the owner)

The frames show a few things the API cannot provide today. The owner approved small backend changes, following existing patterns (Zod validation, `createAuditLog`, JSON errors):

1. **Share expiry**: `POST /files/:id/share` accepts an optional body `{ expiresIn: 'never' | '1d' | '7d' | '30d' }` and sets `FileShare.expiresAt`. Changing expiry on an existing link updates it. The share dialog's "Link expires" select uses this.
2. **Audit coverage** so Activity filters are meaningful: log `CREATE_SHARE_LINK`, `REVOKE_SHARE_LINK`, `INVITE_SENT`, `INVITE_REVOKED`, `CONNECT_ACCOUNT` (Google and S3), `DISCONNECT_ACCOUNT`, and `UPLOAD_FILE` for every successful upload path (multipart Google, multipart S3, resumable Google), with metadata `{ name, size, provider, accountLabel }`.
3. **Upload target visibility**: `/uploads/resumable/init` also returns `{ accountId, accountLabel }` (e.g. `Drive · work@example.com`) so the upload panel can show where each file is going.
4. **S3 uploads from the web UI**: today resumable init accepts S3 but the chunk endpoint rejects it and the frontend has no fallback, so S3 uploads from the browser fail. Fix it: when init returns `provider: 's3'`, the frontend uploads that file through the existing streaming `POST /uploads` multipart path (with the same target account), and progress still shows in the upload panel.

Run `cd backend && npm run build` after these.

## Calls made during review (Claude's, not the owner's; easy to revisit)

- **Redirect URI stays editable** in Settings → Google sign-in, with the server default as placeholder and the hint below. Making it read-only would strand Docker installs, where the backend sits under `/api`.
- **"Make public on Google Drive" stays** as an explicit action, but moves out of the share dialog: it appears in the details panel (Google Drive files only) as a secondary action with a confirmation that explains anyone with the Drive link can view. The share dialog footer note stays true because the dialog itself never touches Drive permissions.
- **Priority order editor stays**: when "Priority order" is selected, an ordered list of connected accounts appears under the option cards with move up/down buttons, saved through `PATCH /storage/routing-policy`.
- **All files keeps multi-select and batch actions**: a checkbox column (visible on row hover and whenever anything is selected), and the same selection bar pattern as Trash with Move to…, Download (zip), Move to Trash. Clicking a row (outside the checkbox) selects it for the details panel; checking boxes is separate.
- **Upload keeps a dialog**: the sidebar Upload button opens a small dialog (drop zone, destination folder, destination account with "Automatic (routing rule)" as default) styled like the share dialog, then the upload panel takes over.

## Responsive (decided)

Below 1024px the sidebar becomes an off-canvas drawer opened from a menu button in the top bar (current behavior), the details panel becomes a bottom sheet or is hidden behind the row menu "Details", and tables drop the Stored in / Modified columns before Size. No horizontal page scroll at 375px.

## Constraints

- Stack stays: React 19, Tailwind 4, lucide-react, cva, clsx, tailwind-merge. No new dependencies.
- Keep conventions from AGENTS.md: `@/*` imports, `apiFetch`, `cn`, routes in `App.tsx`, URL state for `folderId`/`q`.
- Keep `Button`, `Card`, `Input` as the primitives (restyled), adding only what the frames need repeatedly (e.g. Badge, Segmented, Checkbox, Switch, Menu, Dialog) as small local components.
- Verification is `cd frontend && npm run build`. The PWA service-worker step fails only because the local repo path contains apostrophes; tsc + vite bundle passing is the bar, plus a manual run of every page in both themes.

## Left to the builder

- Component file structure and how big pages (AllFilesPage, SettingsPage, DriveLayout) are split up.
- Utility class naming for tokens.
- Exact empty/loading/error states and the look of pages not in the frames, within the system above.
- Keyboard shortcut wiring for `⌘K` (focus search is enough).
- Order of migration, as long as each step builds.
