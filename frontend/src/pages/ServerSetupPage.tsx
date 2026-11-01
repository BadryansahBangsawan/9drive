import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { clearAuthSession } from '@/lib/auth'
import { DEFAULT_SERVER_URL, getServerUrl, normalizeServerUrl, setServerUrl } from '@/lib/runtime'

// Desktop only: the 9Drive server this app signs in to. Shown at first launch and from the sign-in
// page. The address is checked against the server's /api/health before it is saved.
export function ServerSetupPage({ onSaved }: { onSaved?: () => void }) {
  const navigate = useNavigate()
  const current = getServerUrl()
  const [value, setValue] = useState(current ?? DEFAULT_SERVER_URL)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const url = normalizeServerUrl(value)
    if (!url) {
      setError('Enter the address you open 9Drive at, like 9drive.example.com.')
      return
    }
    setChecking(true)
    setError('')
    try {
      const response = await fetch(`${url}/api/health`)
      const data = response.ok ? await response.json().catch(() => null) as { status?: string } | null : null
      if (data?.status !== 'ok') throw new Error('not a 9Drive server')
      // Tokens belong to the server that issued them.
      if (url !== current) clearAuthSession()
      setServerUrl(url)
      onSaved?.()
      navigate('/login', { replace: true })
    } catch {
      setError(`Couldn’t reach a 9Drive server at ${url}. Check the address and your connection.`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.015em] text-text">Connect to your 9Drive</h1>
      <p className="mt-1 text-[13px] text-muted">The address you open 9Drive at in a browser.</p>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        <label className="grid gap-1.5 text-[13px] font-medium text-text">
          Server address
          <Input
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'server-error' : undefined}
            required
          />
        </label>
        {error ? <p id="server-error" role="alert" className="text-[13px] text-danger">{error}</p> : null}
        <Button size="lg" className="w-full" disabled={checking}>{checking ? 'Checking…' : 'Continue'}</Button>
        {current ? <Button type="button" variant="ghost" className="w-full" onClick={() => navigate(-1)}>Cancel</Button> : null}
      </form>
    </AuthShell>
  )
}
