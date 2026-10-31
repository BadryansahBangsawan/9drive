export function accountLabel(account: { provider: string; email: string; displayName?: string | null }): string {
  if (account.provider === 's3') return `S3 · ${account.displayName || account.email}`
  return `Drive · ${account.email}`
}
