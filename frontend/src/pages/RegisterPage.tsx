import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { AuthDivider, AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { setAuthSession, type AuthUser } from '@/lib/auth'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim()

declare global {
  interface Window {
    grecaptcha?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void }) => number
      reset: (widgetId?: number) => void
    }
  }
}

export function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const recaptchaRef = useRef<HTMLDivElement | null>(null)
  const recaptchaWidgetId = useRef<number | null>(null)

  useEffect(() => {
    if (!recaptchaSiteKey) return
    const scriptId = 'google-recaptcha-script'
    const renderCaptcha = () => {
      if (!recaptchaRef.current || !window.grecaptcha || recaptchaWidgetId.current !== null) return
      recaptchaWidgetId.current = window.grecaptcha.render(recaptchaRef.current, {
        sitekey: recaptchaSiteKey,
        callback: setCaptchaToken,
        'expired-callback': () => setCaptchaToken(''),
      })
    }

    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://www.google.com/recaptcha/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.onload = renderCaptcha
      document.body.appendChild(script)
    } else {
      renderCaptcha()
    }
  }, [])

  async function continueWithGoogle() {
    setGoogleLoading(true)
    setError('')
    try {
      const data = await apiFetch<{ url: string }>('/auth/google/url', { skipAuth: true })
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google register failed')
      setGoogleLoading(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    if (recaptchaSiteKey && !captchaToken) {
      setError('Please complete the captcha.')
      setLoading(false)
      return
    }
    try {
      const data = await apiFetch<AuthResponse>('/auth/register', { method: 'POST', skipAuth: true, body: JSON.stringify({ name, email, password, captchaToken }) })
      setAuthSession(data.accessToken, data.refreshToken, data.user)
      navigate('/all-files')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Register failed')
      if (recaptchaWidgetId.current !== null) window.grecaptcha?.reset(recaptchaWidgetId.current)
      setCaptchaToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.015em] text-text">Create your account</h1>
      <p className="mt-1 text-[13px] text-muted">Set up your storage gateway.</p>
      <Button variant="secondary" size="lg" className="mt-6 w-full" disabled={googleLoading} onClick={continueWithGoogle}>
        <GoogleLogo />{googleLoading ? 'Redirecting...' : 'Continue with Google and connect Drive'}
      </Button>
      <AuthDivider />
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-[13px] font-medium text-text">Name<Input autoComplete="name" aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-error' : undefined} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="grid gap-1.5 text-[13px] font-medium text-text">Email<Input type="email" autoComplete="email" aria-invalid={error ? true : undefined} aria-describedby={error ? 'auth-error' : undefined} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="grid gap-1.5 text-[13px] font-medium text-text">
          Password
          <Input type="password" autoComplete="new-password" minLength={8} aria-invalid={error ? true : undefined} aria-describedby={error ? 'password-hint auth-error' : 'password-hint'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <p id="password-hint" className="-mt-2.5 text-xs text-subtle">At least 8 characters.</p>
        {recaptchaSiteKey ? <div className="min-h-[78px] overflow-hidden"><div ref={recaptchaRef} /></div> : null}
        {error ? <p id="auth-error" role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <Button size="lg" className="w-full" disabled={loading}>{loading ? 'Creating...' : 'Create account'}</Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">Already registered? <Link className="font-medium text-accent hover:underline" to="/login">Log in</Link></p>
    </AuthShell>
  )
}
