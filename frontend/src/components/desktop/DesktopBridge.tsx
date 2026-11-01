import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiUrl } from '@/lib/api'
import { getAccessToken, getRefreshToken, onAuthChange, setAccessToken } from '@/lib/auth'
import { ask, invoke, listen, offerUpdate, onDeepLink, uploader } from '@/lib/desktop'

// Desktop only (rendered by App inside the router). Connects the React app to the native side:
// - hands the session tokens to the native uploader, and takes back tokens it refreshed;
// - turns ninedrive:// links (Google sign-in / connect finishing in the browser) into navigation;
// - offers app updates;
// - asks before quitting while uploads are running (they resume on the next launch either way).
// Deep links already acted on. The plugin reports the launch link again (getCurrent) every time
// it's asked, and a google-auth token works only once: replaying it would sign the user out.
// Kept in localStorage so a reloaded window doesn't act on them again either.
const HANDLED_KEY = '9drive:handled-links'
function readHandled(): string[] {
  try { return JSON.parse(localStorage.getItem(HANDLED_KEY) ?? '[]') as string[] } catch { return [] }
}
function markHandled(link: string) {
  const handled = readHandled()
  if (handled.includes(link)) return false
  try { localStorage.setItem(HANDLED_KEY, JSON.stringify([...handled, link].slice(-20))) } catch { /* storage unavailable */ }
  return true
}

export function DesktopBridge() {
  const navigate = useNavigate()
  // useNavigate() changes on every navigation in BrowserRouter; the effect below must run once.
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

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
          if (!markHandled(raw)) continue
          let url: URL
          try { url = new URL(raw) } catch { continue }
          // ninedrive://google-auth?token=… → the web app's handoff page; ninedrive://google-connected?status=…
          const page = url.host || url.pathname.replace(/^\/+/, '')
          if (page === 'google-auth') navigateRef.current(`/google-auth${url.search}`)
          else if (page === 'google-connected') {
            window.dispatchEvent(new CustomEvent('9drive:google-connected', { detail: url.searchParams.get('status') ?? 'error' }))
            navigateRef.current('/quota')
          }
        }
      }),
    ]
    offerUpdate().catch((error) => console.warn('Update check failed', error))
    return () => {
      stopAuth()
      for (const subscription of subscriptions) subscription.then((unlisten) => unlisten()).catch(() => undefined)
    }
  }, [])

  return null
}
