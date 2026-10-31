import type { NextFunction, Response } from 'express'
import { prisma } from '../config/prisma.js'
import type { AuthRequest } from './auth.middleware.js'

// Use after requireAuth. Instance-wide settings and maintenance actions are admin-only.
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { role: true } })
    if (user?.role !== 'admin') return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
    return next()
  } catch (error) {
    return next(error)
  }
}
