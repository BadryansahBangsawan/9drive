import { z } from 'zod'

// Which app started a Google OAuth flow. The desktop app opens Google in the system browser (Google
// blocks sign-in inside embedded webviews), so its callback returns through a ninedrive:// link.
export const oauthClientSchema = z.enum(['web', 'desktop']).default('web')
export type OauthClient = z.infer<typeof oauthClientSchema>

export const DESKTOP_URL_SCHEME = 'ninedrive'

export function oauthReturnUrl(frontendUrl: string, client: string | null | undefined, page: 'google-auth' | 'google-connected', query: Record<string, string>) {
  const search = new URLSearchParams(query).toString()
  return client === 'desktop' ? `${DESKTOP_URL_SCHEME}://${page}?${search}` : `${frontendUrl}/${page}?${search}`
}
