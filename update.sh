#!/usr/bin/env bash
# Self-update for a bare-metal install: a git checkout whose backend runs under a supervisor that
# restarts it when it exits with a failure (systemd `Restart=on-failure`, pm2, ...).
#
# Started by POST /system/update from the backend, which is this script's parent process. Output
# goes to update.log, which Settings polls. The final "=== System Update Completed" line is written
# by the new backend once it is up (markUpdateCompleted in backend/src/utils/app-version.ts), so the
# UI doesn't report success before the new version is serving.
#
# A failed run must leave the running version untouched. Everything is built in a separate git
# worktree (.update-staging): dependencies, Prisma client, backend dist, frontend dist. Only when
# all of it succeeds are node_modules and dist swapped in by rename, the checkout fast-forwarded,
# the database migrated, and the backend restarted.
#
# Docker installs don't use this: the backend container has no git, and the route says so.
set -Eeuo pipefail

# Everything is inside functions so bash has read the whole script before git replaces it.

ROOT=""
STAGE=""

lock_hash() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

remove_stage() {
  [ -n "$STAGE" ] || return 0
  git -C "$ROOT" worktree remove --force "$STAGE" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
  git -C "$ROOT" worktree prune
}

# Dependencies for one package in the staging tree. Reuses a copy of the live node_modules when
# the lockfile is the one installed there; otherwise a clean install. --include=dev: the service
# runs with NODE_ENV=production, which would make npm skip the build's devDependencies.
prepare_deps() {
  local pkg="$1" live="$ROOT/$1/node_modules" staged="$STAGE/$1/node_modules" hash
  hash="$(lock_hash "$STAGE/$pkg/package-lock.json")"
  if [ -d "$live" ] && [ "$(cat "$live/.9drive-lock-hash" 2>/dev/null || true)" = "$hash" ]; then
    echo "$pkg: dependencies unchanged, copying"
    cp -a "$live" "$staged"
  else
    echo "$pkg: installing dependencies"
    cd "$STAGE/$pkg"
    npm ci --include=dev --no-audit --no-fund
    cd "$ROOT"
    echo "$hash" >"$staged/.9drive-lock-hash"
  fi
}

# Replace a live build output or dependency folder with the staged one (rename, near-atomic).
swap_in() {
  local rel="$1"
  [ -e "$STAGE/$rel" ] || return 0
  rm -rf "$ROOT/$rel.old"
  if [ -e "$ROOT/$rel" ]; then mv "$ROOT/$rel" "$ROOT/$rel.old"; fi
  mv "$STAGE/$rel" "$ROOT/$rel"
  rm -rf "$ROOT/$rel.old"
}

main() {
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  STAGE="$ROOT/.update-staging"
  cd "$ROOT"
  exec >>"$ROOT/update.log" 2>&1
  trap 'echo "=== System Update Failed: $(date -u +%FT%TZ) (line $LINENO) ==="; remove_stage' ERR

  echo "=== System Update Started: $(date -u +%FT%TZ) ==="
  git fetch --quiet
  local before after
  before="$(git rev-parse HEAD)"
  after="$(git rev-parse '@{u}')"
  if ! git merge-base --is-ancestor "$before" "$after"; then
    echo "The checkout has commits that are not on its upstream branch; update it by hand."
    false
  fi
  echo "Code: ${before:0:7} -> ${after:0:7}"

  remove_stage
  git worktree add --detach --quiet "$STAGE" "$after"
  # Untracked configuration the build reads (Vite embeds VITE_* at build time).
  local f
  for f in backend/.env frontend/.env frontend/.env.local frontend/.env.production frontend/.env.production.local; do
    if [ -f "$ROOT/$f" ]; then cp -p "$ROOT/$f" "$STAGE/$f"; fi
  done

  echo "--- backend"
  prepare_deps backend
  cd "$STAGE/backend"
  npx --no-install prisma generate
  npx --no-install tsc --noEmitOnError
  cd "$ROOT"

  echo "--- frontend"
  prepare_deps frontend
  cd "$STAGE/frontend"
  npm run build
  cd "$ROOT"

  echo "--- switching to ${after:0:7}"
  swap_in backend/node_modules
  swap_in backend/dist
  swap_in frontend/node_modules
  swap_in frontend/dist
  # An older checkout may hold this script as an untracked copy; let git own it.
  git ls-files --error-unmatch update.sh >/dev/null 2>&1 || rm -f update.sh
  git merge --ff-only --quiet "$after"
  remove_stage

  # Migrate last, so a failed build never leaves the running backend on a schema it doesn't expect.
  echo "--- database"
  cd "$ROOT/backend"
  npx --no-install prisma migrate deploy
  cd "$ROOT"

  echo "Built version $(node -p "require('$ROOT/backend/package.json').version")"
  touch "$ROOT/.update-pending"
  echo "Restarting backend..."
  # Ending the parent backend with a signal that counts as a failure makes the supervisor start
  # the new build. The supervisor stops this script along with it, so this is the last step.
  if [ "$PPID" -gt 1 ]; then kill -USR2 "$PPID"; fi
}

main "$@"
exit
