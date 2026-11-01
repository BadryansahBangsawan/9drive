import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  // Allow S3 endpoints on private/loopback addresses (e.g. a MinIO container on the same network).
  S3_ALLOW_PRIVATE_ENDPOINTS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  // Origins of the desktop app's webview (Tauri), allowed by CORS next to FRONTEND_URL. Comma-separated;
  // set it empty to refuse the desktop app.
  DESKTOP_APP_ORIGINS: z.string().default('tauri://localhost,http://tauri.localhost,https://tauri.localhost')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
})

export const env = envSchema.parse(process.env)
