import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AuthDivider, AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { isDesktop } from '@/lib/runtime'
import { openExternal } from '@/lib/desktop'
import { DesktopAuthFooter } from '@/components/desktop/DesktopAuthFooter'
import { setAuthSession, type AuthUser } from '@/lib/auth'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function continueWithGoogle() {
    setGoogleLoading(true)
    setError('')
    try {
      if (isDesktop) {
        // Google blocks sign-in inside embedded webviews: finish in the browser, which returns
        // through a ninedrive:// link (DesktopBridge).
        const data = await apiFetch<{ url: string }>('/auth/google/url?client=desktop', { skipAuth: true })
        await openExternal(data.url)
        setNotice('Continue in your browser. 9Drive comes back when you are signed in.')
        setGoogleLoading(false)
        return
      }
      const data = await apiFetch<{ url: string }>('/auth/google/url', { skipAuth: true })
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed')
      setGoogleLoading(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch<AuthResponse>('/auth/login', { method: 'POST', skipAuth: true, body: JSON.stringify({ email, password }) })
      setAuthSession(data.accessToken, data.refreshToken, data.user)
      navigate('/all-files')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.015em] text-text">Log in to 9Drive</h1>
      <p className="mt-1 text-[13px] text-muted">Access your storage gateway.</p>
      <Button variant="secondary" size="lg" className="mt-6 w-full" disabled={googleLoading} onClick={continueWithGoogle}>
        <GoogleLogo />{googleLoading ? 'Redirecting...' : 'Continue with Google'}
      </Button>
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-[13px] font-medium text-text">Email<Input type="email" autoComplete="email" aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-error' : undefined} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="grid gap-1.5 text-[13px] font-medium text-text">Password<Input type="password" autoComplete="current-password" aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-error' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error ? <p id="auth-error" role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <Button size="lg" className="w-full" disabled={loading}>{loading ? 'Logging in...' : 'Log in'}</Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">No account? <Link className="font-medium text-accent hover:underline" to="/register">Register</Link></p>
      <DesktopAuthFooter notice={notice} />
    </AuthShell>
  )
}
