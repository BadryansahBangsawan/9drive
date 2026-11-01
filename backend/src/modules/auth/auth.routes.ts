import { Router } from 'express'
import { google } from '../google/google-apis.js'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { requireAuth, type AuthRequest } from '../../middleware/auth.middleware.js'
import { hashPassword, verifyPassword } from '../../utils/password.js'
import { hashToken, randomToken } from '../../utils/crypto.js'
import { signAccessToken } from '../../utils/jwt.js'
import { rateLimit } from '../../middleware/rate-limit.middleware.js'
import { createOAuthClient } from '../google/google.service.js'
import { completeGoogleLogin, roleForNewUser } from './google-login.js'
import { oauthClientSchema, oauthReturnUrl } from '../../utils/oauth-return.js'

export const authRouter = Router()

const registerSchema = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), captchaToken: z.string().optional() })
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
const refreshSchema = z.object({ refreshToken: z.string().min(1) })
const googleExchangeSchema = z.object({ token: z.string().min(1) })

const credentialLimiter = rateLimit({ name: 'auth-credentials', windowMs: 15 * 60_000, max: 20 })
const tokenLimiter = rateLimit({ name: 'auth-tokens', windowMs: 60_000, max: 60 })

function publicUser(user: { id: string; name: string; email: string; role: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}

async function createSession(userId: string, req: AuthRequest) {
  const refreshToken = randomToken()
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
  const session = await prisma.userSession.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: req.header('User-Agent'),
      ipAddress: req.ip,
      expiresAt,
    },
  })
  return { accessToken: signAccessToken({ sub: userId, sid: session.id }), refreshToken }
}

async function verifyCaptcha(token: string | undefined) {
  if (!env.RECAPTCHA_SECRET_KEY) return true
  if (!token) return false
  const form = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY, response: token })
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body: form })
  const data = await response.json() as { success?: boolean }
  return Boolean(data.success)
}

authRouter.post('/register', credentialLimiter, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body)
    if (!(await verifyCaptcha(body.captchaToken))) return res.status(400).json({ code: 'CAPTCHA_FAILED', message: 'Captcha verification failed.' })
    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    if (existing) return res.status(409).json({ code: 'AUTH_EMAIL_TAKEN', message: 'Email already registered.' })
    const user = await prisma.user.create({ data: { name: body.name, email: body.email, passwordHash: await hashPassword(body.password), role: await roleForNewUser() } })
    const tokens = await createSession(user.id, req)
    return res.status(201).json({ ...tokens, user: publicUser(user) })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/login', credentialLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email: body.email } })
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) return res.status(401).json({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password.' })
    const tokens = await createSession(user.id, req)
    return res.json({ ...tokens, user: publicUser(user) })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/url', async (req, res, next) => {
  try {
    const client = oauthClientSchema.parse(req.query.client ?? undefined)
    const config = await prisma.providerConfig.findFirstOrThrow({ where: { userId: null, provider: 'google_drive', status: 'active' }, orderBy: { createdAt: 'desc' } })
    const state = randomToken()
    await prisma.oauthState.create({ data: { providerConfigId: config.id, flow: 'login', client, stateHash: hashToken(state), expiresAt: new Date(Date.now() + 10 * 60_000) } })
    const oauth = createOAuthClient(config)
    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: config.scopes as string[],
      state,
    })
    return res.json({ url })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/google/callback', async (req, res) => {
  try {
    const query = z.object({ code: z.string(), state: z.string() }).parse(req.query)
    const oauthState = await prisma.oauthState.findUniqueOrThrow({ where: { stateHash: hashToken(query.state) }, include: { providerConfig: true } })
    if (oauthState.flow !== 'login' || oauthState.usedAt || oauthState.expiresAt < new Date()) return res.redirect(oauthReturnUrl(env.FRONTEND_URL, oauthState.client, 'google-auth', { status: 'error' }))

    const client = createOAuthClient(oauthState.providerConfig)
    const { tokens } = await client.getToken(query.code)
    client.setCredentials(tokens)
    const profile = await google.oauth2({ version: 'v2', auth: client }).userinfo.get()

    const handoffToken = await completeGoogleLogin(oauthState, tokens, profile.data)
    if (!handoffToken) return res.redirect(oauthReturnUrl(env.FRONTEND_URL, oauthState.client, 'google-auth', { status: 'error' }))
    return res.redirect(oauthReturnUrl(env.FRONTEND_URL, oauthState.client, 'google-auth', { token: handoffToken }))
  } catch (error) {
    console.error('Google Auth callback failed:', error)
    return res.redirect(`${env.FRONTEND_URL}/google-auth?status=error`)
  }
})

authRouter.post('/google/exchange', tokenLimiter, async (req, res, next) => {
  try {
    const body = googleExchangeSchema.parse(req.body)
    const handoff = await prisma.authHandoff.findFirst({ where: { tokenHash: hashToken(body.token), usedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } })
    if (!handoff) return res.status(401).json({ code: 'AUTH_GOOGLE_HANDOFF_INVALID', message: 'Google login session expired.' })
    // Claim the token atomically so two concurrent exchanges cannot both create a session.
    const claimed = await prisma.authHandoff.updateMany({ where: { id: handoff.id, usedAt: null }, data: { usedAt: new Date() } })
    if (claimed.count === 0) return res.status(401).json({ code: 'AUTH_GOOGLE_HANDOFF_INVALID', message: 'Google login session expired.' })
    const tokens = await createSession(handoff.userId, req)
    return res.json({ ...tokens, user: publicUser(handoff.user) })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/refresh', tokenLimiter, async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body)
    const session = await prisma.userSession.findFirst({ where: { refreshTokenHash: hashToken(body.refreshToken), revokedAt: null, expiresAt: { gt: new Date() } } })
    if (!session) return res.status(401).json({ code: 'AUTH_SESSION_EXPIRED', message: 'Refresh token expired.' })
    return res.json({ accessToken: signAccessToken({ sub: session.userId, sid: session.id }) })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/logout', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await prisma.userSession.update({ where: { id: req.user!.sessionId }, data: { revokedAt: new Date() } })
    return res.json({ status: 'ok' })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { id: true, name: true, email: true, status: true, role: true } })
    return res.json({ user })
  } catch (error) {
    return next(error)
  }
})
