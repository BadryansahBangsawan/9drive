#!/usr/bin/env bash
# Self-update for a bare-metal install: a git checkout whose backend runs under a supervisor that
# restarts it when it exits with a failure (systemd `Restart=on-failure`, pm2, ...).
#
# Started by POST /system/update from the backend, which is this script's parent process. Output
# goes to update.log, which Settings polls. The final "=== System Update Completed" line is written
# by the new backend once it is up (markUpdateCompleted in backend/src/utils/app-version.ts), so the
# UI doesn't report success before the new version is serving.
#
# Docker installs don't use this: the backend container has no git, and the route says so.
set -Eeuo pipefail

# Everything is inside a function so bash has read the whole script before `git pull` replaces it.
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
  cd "$root/backend"
  if [ ! -d node_modules ] || ! git diff --quiet "$before" "$after" -- package-lock.json; then npm ci --no-audit --no-fund; fi
  npx prisma generate
  npx prisma migrate deploy
  npx tsc
  echo "--- frontend"
  cd "$root/frontend"
  if [ ! -d node_modules ] || ! git diff --quiet "$before" "$after" -- package-lock.json; then npm ci --no-audit --no-fund; fi
  npm run build

  echo "Built version $(node -p "require('$root/backend/package.json').version")"
  touch "$root/.update-pending"
  echo "Restarting backend..."
  # Ending the parent backend with a signal that counts as a failure makes the supervisor start
  # the new build. The supervisor stops this script along with it, so this is the last step.
  if [ "$PPID" -gt 1 ]; then kill -USR2 "$PPID"; fi
}

main "$@"
exit
