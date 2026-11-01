import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiUrl } from '@/lib/api'
import { getAccessToken, getRefreshToken, onAuthChange, setAccessToken } from '@/lib/auth'
import { ask, invoke, listen, offerUpdate, onDeepLink, uploader } from '@/lib/desktop'

// Desktop only (rendered by App inside the router). Connects the React app to the native side:
// - hands the session tokens to the native uploader, and takes back tokens it refreshed;
// - turns ninedrive:// links (Google sign-in / connect finishing in the browser) into navigation;
// - offers app updates;
// - asks before quitting while uploads are running (they resume on the next launch either way).
export function DesktopBridge() {
  const navigate = useNavigate()

  useEffect(() => {
    const sync = () => {
      uploader.configure({ apiUrl: getApiUrl(), accessToken: getAccessToken(), refreshToken: getRefreshToken() }).catch((error) => console.error('Uploader setup failed', error))
    }
    sync()
    const stopAuth = onAuthChange(sync)
    const subscriptions = [
      listen<{ accessToken: string }>('auth://token', ({ accessToken }) => setAccessToken(accessToken)),
      listen<{ active: number }>('app://close-requested', async ({ active }) => {
        const quit = await ask(
          `${active} upload${active === 1 ? ' is' : 's are'} still running. They continue the next time you open 9Drive.`,
          { title: 'Quit 9Drive?', okLabel: 'Quit', cancelLabel: 'Keep uploading' },
        )
        if (quit) await invoke('app_exit')
      }),
      onDeepLink((urls) => {
        for (const raw of urls) {
          let url: URL
          try { url = new URL(raw) } catch { continue }
          // ninedrive://google-auth?token=… → the web app's handoff page; ninedrive://google-connected?status=…
          const page = url.host || url.pathname.replace(/^\/+/, '')
          if (page === 'google-auth') navigate(`/google-auth${url.search}`)
          else if (page === 'google-connected') {
            window.dispatchEvent(new CustomEvent('9drive:google-connected', { detail: url.searchParams.get('status') ?? 'error' }))
            navigate('/quota')
          }
        }
      }),
    ]
    offerUpdate().catch((error) => console.warn('Update check failed', error))
    return () => {
      stopAuth()
      for (const subscription of subscriptions) subscription.then((unlisten) => unlisten()).catch(() => undefined)
    }
  }, [navigate])

  return null
}
