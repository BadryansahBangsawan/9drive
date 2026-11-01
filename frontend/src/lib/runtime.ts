// The same React app runs on the web and inside the desktop app (Tauri). Desktop builds use
// `vite --mode desktop`, which sets VITE_DESKTOP=1 (.env.desktop); web builds drop desktop code.
export const isDesktop = import.meta.env.VITE_DESKTOP === '1'

const SERVER_URL_KEY = '9drive:server-url'
export const DEFAULT_SERVER_URL = 'https://9drive.badry.engineer'

// The 9Drive web address the desktop app talks to (the API is under /api, as nginx serves it).
export function getServerUrl(): string | null {
  try {
    return localStorage.getItem(SERVER_URL_KEY)
  } catch {
    return null
  }
}

export function setServerUrl(url: string) {
  localStorage.setItem(SERVER_URL_KEY, url)
}

// "9drive.example.com" or "https://9drive.example.com/" -> "https://9drive.example.com".
export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}
