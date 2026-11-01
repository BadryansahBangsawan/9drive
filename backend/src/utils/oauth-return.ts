import { z } from 'zod'

// Which app started a Google OAuth flow. The desktop app opens Google in the system browser (Google
// blocks sign-in inside embedded webviews), so its callback returns through a ninedrive:// link.
export const oauthClientSchema = z.enum(['web', 'desktop']).default('web')
export type OauthClient = z.infer<typeof oauthClientSchema>

export const DESKTOP_URL_SCHEME = 'ninedrive'

// Desktop flows go through the web app's /desktop-return page, which says sign-in is done and opens
// the ninedrive:// link (a bare redirect to it would leave the browser tab on Google's consent page).
// The link rides in the URL fragment, so the one-time token never reaches server logs.
export function oauthReturnUrl(frontendUrl: string, client: string | null | undefined, page: 'google-auth' | 'google-connected', query: Record<string, string>) {
  const search = new URLSearchParams(query).toString()
  if (client !== 'desktop') return `${frontendUrl}/${page}?${search}`
  return `${frontendUrl}/desktop-return#${encodeURIComponent(`${DESKTOP_URL_SCHEME}://${page}?${search}`)}`
}
