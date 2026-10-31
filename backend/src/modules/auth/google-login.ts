import type { Auth } from 'googleapis'
import type { OauthState, ProviderConfig } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { accountLabel } from '../../utils/account-label.js'
import { createAuditLog } from '../../utils/audit.js'
import { encryptText, hashToken, randomToken } from '../../utils/crypto.js'
import { hashPassword } from '../../utils/password.js'
import { syncGoogleQuota } from '../google/google.service.js'

export type GoogleProfile = { id?: string | null; email?: string | null; verified_email?: boolean | null; name?: string | null; picture?: string | null }

// The first account on an instance without an admin becomes the admin.
export async function roleForNewUser() {
  const admins = await prisma.user.count({ where: { role: 'admin' } })
  return admins === 0 ? 'admin' : 'user'
}

// Finds or creates the app user for a Google sign-in. Google has proven ownership of the email,
// so an existing account whose email was never verified (a password registration) is handed to
// the Google owner: its password, sessions and API keys are invalidated so whoever registered
// that address first cannot keep access.
async function upsertGoogleUser(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (!existing) {
    return prisma.user.create({ data: { email, name, passwordHash: await hashPassword(randomToken(32)), emailVerifiedAt: new Date(), role: await roleForNewUser() } })
  }
  if (existing.emailVerifiedAt) return prisma.user.update({ where: { id: existing.id }, data: { name } })

  const now = new Date()
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: existing.id }, data: { name, emailVerifiedAt: now, passwordHash: await hashPassword(randomToken(32)) } }),
    prisma.userSession.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: now } }),
    prisma.apiKey.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { status: 'revoked', revokedAt: now } }),
  ])
  return user
}

// Completes the "login" OAuth flow and returns a one-time handoff token, or null on failure.
export async function completeGoogleLogin(oauthState: OauthState & { providerConfig: ProviderConfig }, tokens: Auth.Credentials, profile: GoogleProfile) {
  const providerAccountId = profile.id
  const email = profile.email
  if (!providerAccountId || !email || !tokens.access_token) return null
  if (profile.verified_email === false) return null

  const name = profile.name || email.split('@')[0] || 'Google User'
  const user = await upsertGoogleUser(email, name)
  const existingAccount = await prisma.connectedAccount.findUnique({ where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } } })
  const refreshTokenEncrypted = tokens.refresh_token ? encryptText(tokens.refresh_token) : existingAccount?.refreshTokenEncrypted
  if (!refreshTokenEncrypted) {
    console.error('Google login failed: no refresh token received and no existing account.')
    return null
  }

  const accountData = {
    providerConfigId: oauthState.providerConfigId,
    email,
    displayName: profile.name,
    avatarUrl: profile.picture,
    accessTokenEncrypted: encryptText(tokens.access_token),
    refreshTokenEncrypted,
    tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
    scopes: oauthState.providerConfig.scopes as string[],
    status: 'connected',
  }
  const account = await prisma.connectedAccount.upsert({
    where: { userId_provider_providerAccountId: { userId: user.id, provider: 'google_drive', providerAccountId } },
    create: { userId: user.id, provider: 'google_drive', providerAccountId, ...accountData },
    update: accountData,
  })

  await createAuditLog(user.id, 'CONNECT_ACCOUNT', 'account', account.id, { provider: 'google_drive', accountLabel: accountLabel(account) })
  await prisma.oauthState.update({ where: { id: oauthState.id }, data: { usedAt: new Date(), userId: user.id } })
  await syncGoogleQuota(account.id).catch(() => undefined)

  const handoffToken = randomToken()
  await prisma.authHandoff.create({ data: { userId: user.id, tokenHash: hashToken(handoffToken), expiresAt: new Date(Date.now() + 5 * 60_000) } })
  return handoffToken
}
