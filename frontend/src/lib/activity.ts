export type ActivityCategory = 'uploads' | 'sharing' | 'deleted' | 'other'

const SHARING = new Set(['CREATE_SHARE_LINK', 'UPDATE_SHARE_LINK', 'REVOKE_SHARE_LINK', 'MAKE_FILE_PUBLIC', 'INVITE_SENT', 'INVITE_REVOKED'])
const DELETED = new Set(['TRASH_FILE', 'PERMANENT_DELETE_FILE', 'DELETE_FOLDER'])

export function activityCategory(action: string): ActivityCategory {
  if (action === 'UPLOAD_FILE') return 'uploads'
  if (SHARING.has(action)) return 'sharing'
  if (DELETED.has(action)) return 'deleted'
  return 'other'
}

const VERBS: Record<string, string> = {
  UPLOAD_FILE: 'Uploaded',
  CREATE_SHARE_LINK: 'Created share link for',
  UPDATE_SHARE_LINK: 'Updated share link for',
  REVOKE_SHARE_LINK: 'Revoked share link for',
  MAKE_FILE_PUBLIC: 'Made public',
  INVITE_SENT: 'Invited',
  INVITE_REVOKED: 'Revoked invite for',
  CONNECT_ACCOUNT: 'Connected',
  DISCONNECT_ACCOUNT: 'Disconnected',
  TRASH_FILE: 'Moved to trash',
  PERMANENT_DELETE_FILE: 'Permanently deleted',
  RESTORE_FILE: 'Restored',
  CREATE_FOLDER: 'Created folder',
  UPDATE_FOLDER: 'Updated folder',
  DELETE_FOLDER: 'Deleted folder',
  MOVE_FILES: 'Moved',
  UPDATE_FILE: 'Updated',
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {}
  try {
    const parsed = JSON.parse(metadata)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function sentenceCase(action: string) {
  const text = action.toLowerCase().replace(/_/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function describeActivity(log: { action: string; metadata: string | null }): { verb: string; object: string; suffix?: string } {
  const meta = parseMetadata(log.metadata)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const object = str(meta.name) || str(meta.email) || str(meta.accountLabel) || ''
  const verb = VERBS[log.action] ?? sentenceCase(log.action)
  if (log.action === 'UPLOAD_FILE') {
    const label = str(meta.accountLabel)
    return label ? { verb, object: str(meta.name), suffix: `to ${label}` } : { verb, object: str(meta.name) }
  }
  if (log.action === 'MOVE_FILES' && typeof meta.count === 'number') return { verb, object: `${meta.count} file${meta.count === 1 ? '' : 's'}` }
  return { verb, object }
}
