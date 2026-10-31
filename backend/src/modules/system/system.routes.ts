import { Router } from 'express'
import { exec, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { requireAdmin } from '../../middleware/admin.middleware.js'
import { prisma } from '../../config/prisma.js'
import { decryptText, encryptText } from '../../utils/crypto.js'

// Instance-wide settings and maintenance. Admin only.
export const systemRouter = Router()
systemRouter.use(requireAuth, requireAdmin)

const googleConfigSchema = z.object({
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().trim().max(512).optional().or(z.literal('')),
  redirectUri: z.string().url().max(2048).optional().or(z.literal('')),
})

systemRouter.post('/update', (_req, res) => {
  const projectRoot = path.resolve(process.cwd(), '..')
  const updateScript = path.join(projectRoot, 'update.sh')

  exec('git --version', (gitError) => {
    if (gitError) {
      return res.status(400).json({
        code: 'GIT_NOT_FOUND',
        message: 'Git is not installed inside the app container. If you run 9Drive in Docker, update from the host instead:\n\n1. cd into your 9drive checkout\n2. git pull\n3. docker compose up -d --build',
      })
    }

    if (fs.existsSync(updateScript)) {
      try {
        // Clear old update log to prevent race conditions on frontend polling
        fs.writeFileSync(path.join(projectRoot, 'update.log'), 'Initiating update...\n')
        const child = spawn('bash', ['update.sh'], { cwd: projectRoot, detached: true, stdio: 'ignore' })
        child.unref()
        return res.json({
          status: 'success',
          message: 'System update initiated. Rebuilding and restarting backend & frontend in the background. Please wait ~1 minute and refresh the page.',
        })
      } catch (error) {
        console.error('Failed to start update script:', error)
        return res.status(500).json({ code: 'UPDATE_FAILED', message: 'Failed to start update script.' })
      }
    }

    // Fallback to simple git pull if update.sh doesn't exist
    exec('git pull', { cwd: projectRoot }, (error, stdout, stderr) => {
      if (error) {
        console.error('System update failed:', error, stderr)
        return res.status(500).json({ code: 'UPDATE_FAILED', message: 'Failed to run git pull. Make sure git is installed and configured.' })
      }
      console.log('System update stdout:', stdout)
      if (stderr) console.warn('System update stderr:', stderr)
      return res.json({ status: 'success', message: 'System code updated successfully. Dev servers will auto-restart.', stdout, stderr })
    })
  })
})

systemRouter.get('/update-log', (_req, res) => {
  const logFile = path.join(path.resolve(process.cwd(), '..'), 'update.log')
  if (!fs.existsSync(logFile)) return res.json({ log: 'No update history found.' })
  try {
    return res.json({ log: fs.readFileSync(logFile, 'utf8') })
  } catch (error) {
    console.error('Failed to read update log:', error)
    return res.status(500).json({ code: 'READ_LOG_FAILED', message: 'Failed to read update log file.' })
  }
})

systemRouter.get('/google-config', async (req, res, next) => {
  try {
    const config = await prisma.providerConfig.findFirst({
      where: { userId: null, provider: 'google_drive', status: 'active' },
      orderBy: { createdAt: 'desc' },
    })
    const defaultRedirect = `${req.protocol}://${req.get('host')}/connected-accounts/google/callback`
    if (!config) return res.json({ exists: false, defaultRedirectUri: defaultRedirect })

    let clientId = ''
    try {
      clientId = decryptText(config.clientIdEncrypted)
    } catch {
      clientId = ''
    }
    return res.json({ exists: true, clientId, redirectUri: config.redirectUri, hasSecret: !!config.clientSecretEncrypted, defaultRedirectUri: defaultRedirect })
  } catch (error) {
    return next(error)
  }
})

systemRouter.post('/google-config', async (req, res, next) => {
  try {
    const { clientId, clientSecret, redirectUri } = googleConfigSchema.parse(req.body)
    const defaultRedirect = `${req.protocol}://${req.get('host')}/connected-accounts/google/callback`
    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ]

    // Reuse the current secret when the form leaves it blank.
    let finalSecret = clientSecret || ''
    if (!finalSecret) {
      const current = await prisma.providerConfig.findFirst({ where: { userId: null, provider: 'google_drive' }, orderBy: { createdAt: 'desc' } })
      if (current) {
        try {
          finalSecret = decryptText(current.clientSecretEncrypted)
        } catch {
          // ignore
        }
      }
    }
    if (!finalSecret) return res.status(400).json({ code: 'BAD_REQUEST', message: 'Client Secret is required for first-time setup.' })

    const config = await prisma.$transaction(async (tx) => {
      await tx.providerConfig.updateMany({ where: { userId: null, provider: 'google_drive', status: 'active' }, data: { status: 'disabled' } })
      return tx.providerConfig.create({
        data: {
          userId: null,
          provider: 'google_drive',
          clientIdEncrypted: encryptText(clientId),
          clientSecretEncrypted: encryptText(finalSecret),
          redirectUri: redirectUri || defaultRedirect,
          scopes,
          status: 'active',
        },
      })
    })

    return res.status(201).json({ status: 'success', message: 'Global Google OAuth configuration updated successfully.', id: config.id })
  } catch (error) {
    return next(error)
  }
})
