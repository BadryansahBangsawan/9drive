import type { NextFunction, Request, Response } from 'express'

type Bucket = { count: number; resetAt: number }

// Small in-memory fixed-window limiter keyed by client IP. Good enough for a single backend instance.
export function rateLimit({ windowMs, max, name }: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>()

  setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
  }, windowMs).unref()

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${req.ip ?? 'unknown'}`
    const now = Date.now()
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    if (bucket.count > max) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000).toString())
      return res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' })
    }
    return next()
  }
}
