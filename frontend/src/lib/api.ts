import { clearAuthSession, getAccessToken, getRefreshToken, setAccessToken } from '@/lib/auth'
import { getServerUrl, isDesktop } from '@/lib/runtime'

const isProd = import.meta.env.PROD
const rawApiUrl = import.meta.env.VITE_API_URL
const webApiUrl = (rawApiUrl && rawApiUrl !== 'http://localhost:4000')
  ? rawApiUrl
  : (isProd ? '/api' : 'http://localhost:4000')

// The backend base URL. The desktop app talks to the server chosen at first launch.
export function getApiUrl() {
  if (!isDesktop) return webApiUrl
  const server = getServerUrl()
  return server ? `${server}/api` : ''
}

// The web app's address, for links people open in a browser (shared folder links).
export function getWebUrl() {
  return isDesktop ? getServerUrl() ?? '' : window.location.origin
}


type ApiOptions = RequestInit & { skipAuth?: boolean; retry?: boolean }

export async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  const response = await fetch(`${getApiUrl()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
  if (!response.ok) return false
  const data = await response.json() as { accessToken: string }
  setAccessToken(data.accessToken)
  return true
}

// Raw fetch for requests apiFetch can't make (binary bodies, streamed responses).
// Sends the access token, refreshes once on 401, and clears the session if that fails.
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers)
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(`${getApiUrl()}${path}`, { ...init, headers })
  }
  const response = await send()
  if (response.status !== 401) return response
  if (await refreshAccessToken()) {
    const retried = await send()
    if (retried.status === 401) clearAuthSession()
    return retried
  }
  clearAuthSession()
  return response
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const token = getAccessToken()
  if (!options.skipAuth && token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${getApiUrl()}${path}`, { ...options, headers })
  if (response.status === 401 && options.retry !== false && !options.skipAuth && await refreshAccessToken()) {
    return apiFetch<T>(path, { ...options, retry: false })
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    if (response.status === 401) clearAuthSession()
    throw new Error(error.message ?? 'Request failed')
  }

  return response.json() as Promise<T>
}

export function formatBytes(input: string | number | bigint | null | undefined) {
  if (input === null || input === undefined) return '--'
  const bytes = Number(input)
  if (!Number.isFinite(bytes)) return '--'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
