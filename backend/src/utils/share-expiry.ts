export type ShareExpiresIn = 'never' | '1d' | '7d' | '30d'

const DAYS: Record<Exclude<ShareExpiresIn, 'never'>, number> = { '1d': 1, '7d': 7, '30d': 30 }

export function shareExpiresAt(expiresIn: ShareExpiresIn, now: Date = new Date()): Date | null {
  if (expiresIn === 'never') return null
  return new Date(now.getTime() + DAYS[expiresIn] * 24 * 60 * 60 * 1000)
}
