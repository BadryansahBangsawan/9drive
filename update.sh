#!/usr/bin/env bash
# Self-update for a bare-metal install: a git checkout whose backend runs under a supervisor that
# restarts it when it exits with a failure (systemd `Restart=on-failure`, pm2, ...).
#
# Started by POST /system/update from the backend, which is this script's parent process. Output
# goes to update.log, which Settings polls. The final "=== System Update Completed" line is written
# by the new backend once it is up (markUpdateCompleted in backend/src/utils/app-version.ts), so the
# UI doesn't report success before the new version is serving.
#
# A failed run must leave the running version intact: nothing it serves (backend dist, database
# schema) changes until both builds have succeeded.
#
# Docker installs don't use this: the backend container has no git, and the route says so.
set -Eeuo pipefail

# Everything is inside functions so bash has read the whole script before `git pull` replaces it.

lock_hash() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# (Re)install a package's dependencies when its lockfile differs from the one last installed.
# --include=dev: the service runs with NODE_ENV=production, which would otherwise make npm skip
# the devDependencies the build needs (TypeScript, @types/*, Vite).
install_deps() {
  local dir="$1" marker="$1/node_modules/.9drive-lock-hash" hash
  hash="$(lock_hash "$dir/package-lock.json")"
  if [ "$(cat "$marker" 2>/dev/null || true)" != "$hash" ]; then
    (cd "$dir" && npm ci --include=dev --no-audit --no-fund)
    echo "$hash" >"$marker"
  fi
}

main() {
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$root"
  exec >>"$root/update.log" 2>&1
  trap 'echo "=== System Update Failed: $(date -u +%FT%TZ) (line $LINENO) ==="' ERR

  echo "=== System Update Started: $(date -u +%FT%TZ) ==="
  local before after
  before="$(git rev-parse HEAD)"
  # An older checkout may hold this script as an untracked copy; let git own it.
  git ls-files --error-unmatch update.sh >/dev/null 2>&1 || rm -f update.sh
  git pull --ff-only
  after="$(git rev-parse HEAD)"
  echo "Code: ${before:0:7} -> ${after:0:7}"

  echo "--- backend"
  install_deps "$root/backend"
  cd "$root/backend"
  npx --no-install prisma generate
  # --noEmitOnError: a type error must not leave new code in dist/ next to the running build.
  npx --no-install tsc --noEmitOnError

  echo "--- frontend"
  install_deps "$root/frontend"
  cd "$root/frontend"
  npm run build

  # Migrate last, so a failed build leaves the running backend on the schema it expects.
  echo "--- database"
  cd "$root/backend"
  npx --no-install prisma migrate deploy

  echo "Built version $(node -p "require('$root/backend/package.json').version")"
  touch "$root/.update-pending"
  echo "Restarting backend..."
  # Ending the parent backend with a signal that counts as a failure makes the supervisor start
  # the new build. The supervisor stops this script along with it, so this is the last step.
  if [ "$PPID" -gt 1 ]; then kill -USR2 "$PPID"; fi
}

main "$@"
exit
