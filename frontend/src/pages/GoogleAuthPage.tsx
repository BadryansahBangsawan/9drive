import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { apiFetch } from '@/lib/api'
import { setAuthSession, type AuthUser } from '@/lib/auth'
import { takeNext } from '@/lib/redirect'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }

// A handoff token can be exchanged once; effects may run twice (StrictMode, remounts).
const exchanges = new Map<string, Promise<AuthResponse>>()
function exchangeOnce(token: string) {
  let exchange = exchanges.get(token)
  if (!exchange) {
    exchange = apiFetch<AuthResponse>('/auth/google/exchange', { method: 'POST', skipAuth: true, body: JSON.stringify({ token }) })
    exchanges.set(token, exchange)
  }
  return exchange
}

export function GoogleAuthPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [message, setMessage] = useState('Signing you in…')
  const token = params.get('token')
  const status = params.get('status')

  useEffect(() => {
    if (status === 'error' || !token) {
      setMessage('Sign-in failed. Please try again.')
      return
    }

    exchangeOnce(token)
      .then((data) => {
        setAuthSession(data.accessToken, data.refreshToken, data.user)
        navigate(takeNext() ?? '/all-files', { replace: true })
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Sign-in failed. Please try again.'))
  }, [navigate, status, token])

  return (
    <AuthShell>
      <div className="text-center">
        <div className="flex justify-center"><AuthLogo /></div>
        <h1 className="mt-4 text-lg font-semibold text-text">Signing in</h1>
        <p role="status" className="mt-1 text-[13px] text-muted">{message}</p>
      </div>
    </AuthShell>
  )
}
