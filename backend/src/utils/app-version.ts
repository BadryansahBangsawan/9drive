import fs from 'node:fs'
import path from 'node:path'

// The git checkout's root, from both src/utils (tsx) and dist/utils (compiled). Not process.cwd():
// a supervisor may start the backend from any directory.
export const repoRoot = path.resolve(__dirname, '../../..')

// backend/package.json, from both src/utils (tsx) and dist/utils (compiled).
export const appVersion: string = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version

// update.sh leaves .update-pending in the repo root right before it restarts the backend. The new
// backend finishing startup is what "update completed" means, so it writes the line Settings waits for.
export function markUpdateCompleted() {
  const marker = path.join(repoRoot, '.update-pending')
  if (!fs.existsSync(marker)) return
  try {
    fs.appendFileSync(path.join(repoRoot, 'update.log'), `=== System Update Completed: ${new Date().toISOString()} (version ${appVersion}) ===\n`)
    fs.unlinkSync(marker)
  } catch (error) {
    console.error('[startup] failed to record update completion:', error instanceof Error ? error.message : error)
  }
}
