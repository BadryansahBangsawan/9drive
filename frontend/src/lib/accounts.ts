export type ConnectedAccount = {
  id: string
  provider: string
  email: string
  displayName?: string | null
  status?: string
  storageAccount?: {
    usedBytes: string
    totalBytes: string
    availableBytes: string
    lastSyncedAt?: string | null
  } | null
}

// Mirrors backend/src/utils/account-label.ts.
export function accountLabel(account: { provider: string; email: string; displayName?: string | null }): string {
  if (account.provider === 's3') return `S3 · ${account.displayName || account.email}`
  return `Drive · ${account.email}`
}
