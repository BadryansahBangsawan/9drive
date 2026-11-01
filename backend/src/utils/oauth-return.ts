import { z } from 'zod'

// Which app started a Google OAuth flow. The desktop app connects Drive accounts in the system browser
// (Google blocks OAuth inside embedded webviews), so that callback returns through a ninedrive:// link.
// Signing the app in never uses this: it goes through /desktop-auth, which checks the app's state.
export const oauthClientSchema = z.enum(['web', 'desktop']).default('web')
export type OauthClient = z.infer<typeof oauthClientSchema>

export const DESKTOP_URL_SCHEME = 'ninedrive'

// Desktop account connects go through the web app's /desktop-return page, which says it's done and
// opens the ninedrive:// link (a bare redirect would leave the browser tab on Google's consent page).
// Sign-in results always go to the web app: a ninedrive:// link carrying a sign-in token would let any
// page sign someone's app in to another account.
export function oauthReturnUrl(frontendUrl: string, client: string | null | undefined, page: 'google-auth' | 'google-connected', query: Record<string, string>) {
  const search = new URLSearchParams(query).toString()
  if (client !== 'desktop' || page !== 'google-connected') return `${frontendUrl}/${page}?${search}`
  return `${frontendUrl}/desktop-return#${encodeURIComponent(`${DESKTOP_URL_SCHEME}://${page}?${search}`)}`
}
