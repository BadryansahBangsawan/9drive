import { env } from '../../config/env.js'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText, hashToken, randomToken } from '../../utils/crypto.js'

// Share tokens are looked up by hash; the raw token is kept only encrypted so the owner
// can copy the link again. Never store it in plaintext.

export function shareUrl(token: string) {
  return `${env.FRONTEND_URL}/public/files/${token}`
}

export function newShareToken() {
  const token = randomToken(32)
  return { token, data: { tokenHash: hashToken(token), tokenEncrypted: encryptText(token) } }
}

// The raw token of a share row, or null when it can't be recovered (very old rows stored
// only the hash, or the encryption key changed).
export function readShareToken(share: { tokenEncrypted: string | null; token: string | null }) {
  if (share.tokenEncrypted) {
    try {
      return decryptText(share.tokenEncrypted)
    } catch {
      return null
    }
  }
  return share.token
}

// One-time migration of rows written before tokens were encrypted. Idempotent.
export async function encryptLegacyShareTokens() {
  const legacy = await prisma.fileShare.findMany({ where: { token: { not: null } }, select: { id: true, token: true } })
  for (const share of legacy) {
    await prisma.fileShare.update({ where: { id: share.id }, data: { tokenEncrypted: encryptText(share.token!), token: null } })
  }
  return legacy.length
}
