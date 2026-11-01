import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import { AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { getStoredUser } from '@/lib/auth'
import { logout } from '@/lib/session'

// Web page the desktop app opens to sign in (/desktop-auth?state=…). The user is signed in here
// (ProtectedRoute sends them through /login first), confirms, and the app gets a one-time token
// through a ninedrive://auth link, which /desktop-return opens. The confirm click keeps another
// site from silently signing someone's app in.
const statePattern = /^[A-Za-z0-9_-]{16,128}$/

export function DesktopAuthPage() {
  const [params] = useSearchParams()
  const state = params.get('state') ?? ''
  const user = getStoredUser()
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  async function signInApp() {
    setWorking(true)
    setError('')
    try {
      const { token } = await apiFetch<{ token: string }>('/auth/desktop-handoff', { method: 'POST' })
      const link = `ninedrive://auth?${new URLSearchParams({ token, state }).toString()}`
      window.location.assign(`/desktop-return#${encodeURIComponent(link)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t sign the app in.')
      setWorking(false)
    }
  }

  // Signs this browser out for real (the server session too), then back in with another account.
  async function switchAccount() {
    setWorking(true)
    await logout(() => window.location.assign(`/login?next=${encodeURIComponent(`/desktop-auth?state=${state}`)}`))
  }

  if (!statePattern.test(state)) {
    return (
      <AuthShell>
        <AuthLogo />
        <h1 className="mt-4 text-lg font-semibold text-text">Open this from the 9Drive app</h1>
        <p className="mt-1 text-[13px] text-muted">This link signs in the desktop app. Start from “Sign in” in the app.</p>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <AuthLogo />
      <Monitor className="mt-5 h-7 w-7 text-accent" strokeWidth={1.5} aria-hidden="true" />
      <h1 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-text">Sign in to the 9Drive app</h1>
      <p className="mt-1 text-[13px] text-muted">
        The desktop app on this computer will use your account{user ? <> <span className="font-medium text-text">{user.email}</span></> : null}.
      </p>
      {error ? <p role="alert" className="mt-4 text-[13px] text-danger">{error}</p> : null}
      <Button size="lg" className="mt-6 w-full" disabled={working} onClick={signInApp}>{working ? 'Opening the app…' : 'Open 9Drive app'}</Button>
      <Button variant="ghost" className="mt-2 w-full" disabled={working} onClick={switchAccount}>Use a different account</Button>
    </AuthShell>
  )
}
