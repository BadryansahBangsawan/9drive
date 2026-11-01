import { useEffect, useMemo } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
import { AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'

// Where the desktop app's browser flows end: signing the app in (/desktop-auth puts a ninedrive://auth
// link here) and connecting a Google account (the OAuth callback puts a ninedrive://google-connected
// link here). The link rides in the URL fragment; this page opens it and tells the user to go back to
// the app (a bare redirect left the tab on Google's consent page). Other links are refused.
const appPages = ['auth', 'google-connected']

function readLink() {
  try {
    const value = decodeURIComponent(window.location.hash.slice(1))
    const url = new URL(value)
    return url.protocol === 'ninedrive:' && appPages.includes(url.host) ? { link: value, url } : null
  } catch {
    return null
  }
}

export function DesktopReturnPage() {
  const parsed = useMemo(readLink, [])
  const link = parsed?.link ?? null
  const page = parsed?.url.host ?? ''
  const failed = !parsed || parsed.url.searchParams.get('status') === 'error'
  const title = failed
    ? (page === 'google-connected' ? 'Connecting the account failed' : 'Sign-in failed')
    : (page === 'google-connected' ? 'Google Drive connected' : 'The 9Drive app is signed in')

  useEffect(() => {
    if (!link) return
    // Drop the one-time token from the address bar and history, then hand the link to the app.
    window.history.replaceState(null, '', window.location.pathname)
    window.location.href = link
  }, [link])

  return (
    <AuthShell>
      <div className="text-center">
        <div className="flex justify-center"><AuthLogo /></div>
        {failed ? <XCircle className="mx-auto mt-4 h-8 w-8 text-danger" strokeWidth={1.5} aria-hidden="true" /> : <CheckCircle className="mx-auto mt-4 h-8 w-8 text-drive" strokeWidth={1.5} aria-hidden="true" />}
        <h1 className="mt-3 text-lg font-semibold text-text">{title}</h1>
        <p className="mt-1 text-[13px] text-muted">
          {failed ? 'Go back to the 9Drive app and try again.' : 'Go back to the 9Drive app. You can close this tab.'}
        </p>
        {link ? (
          <Button variant="secondary" className="mt-5" onClick={() => { window.location.href = link }}>Open 9Drive</Button>
        ) : null}
      </div>
    </AuthShell>
  )
}
