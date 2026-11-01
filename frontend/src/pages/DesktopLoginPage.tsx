import { useState } from 'react'
import { AuthLogo, AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { DesktopAuthFooter } from '@/components/desktop/DesktopAuthFooter'
import { getServerUrl } from '@/lib/runtime'
import { openExternal } from '@/lib/desktop'
import { beginDesktopSignIn } from '@/lib/desktop-auth'

// Desktop app sign-in: everything happens on the 9Drive website in the browser (email, Google, sign
// up, captcha), which hands the app a session through a ninedrive://auth link (DesktopBridge).
export function DesktopLoginPage({ register = false }: { register?: boolean }) {
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const server = getServerUrl()

  async function open(path: 'login' | 'register') {
    setError('')
    try {
      const target = beginDesktopSignIn(server ?? '')
      await openExternal(path === 'login' ? target : `${server}/register?next=${encodeURIComponent(target.slice((server ?? '').length))}`)
      setWaiting(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t open the browser.')
    }
  }

  return (
    <AuthShell>
      <AuthLogo />
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.015em] text-text">{register ? 'Create your 9Drive account' : 'Sign in to 9Drive'}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {waiting ? 'Finish in your browser. 9Drive opens again when you’re signed in.' : 'You’ll sign in on the 9Drive website in your browser.'}
      </p>
      {error ? <p role="alert" className="mt-4 text-[13px] text-danger">{error}</p> : null}
      <Button size="lg" className="mt-6 w-full" onClick={() => open(register ? 'register' : 'login')}>
        {waiting ? 'Open the browser again' : register ? 'Create account in browser' : 'Sign in with browser'}
      </Button>
      <Button variant="ghost" className="mt-2 w-full" onClick={() => open(register ? 'login' : 'register')}>
        {register ? 'I already have an account' : 'Create an account'}
      </Button>
      <DesktopAuthFooter />
    </AuthShell>
  )
}
