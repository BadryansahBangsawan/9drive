// Desktop sign-in through the website. The app remembers a random state before opening
// <server>/desktop-auth?state=…, and only accepts a ninedrive://auth link carrying one of those
// states, so a link from anywhere else can't sign the app in to someone else's account. Every click
// on "Sign in with browser" adds a state (the last few, for 30 minutes), so any tab it opened works.
const STATE_KEY = '9drive:desktop-auth-states'
const MAX_AGE_MS = 30 * 60_000
const MAX_PENDING = 5

type Pending = { state: string; at: number }

function readPending(): Pending[] {
  try {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) ?? '[]') as Pending[]
    return Array.isArray(value) ? value.filter((p) => typeof p?.state === 'string' && Date.now() - p.at < MAX_AGE_MS) : []
  } catch {
    return []
  }
}

function randomState() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Returns the website URL to open in the browser.
export function beginDesktopSignIn(server: string) {
  const state = randomState()
  localStorage.setItem(STATE_KEY, JSON.stringify([...readPending(), { state, at: Date.now() }].slice(-MAX_PENDING)))
  return `${server}/desktop-auth?state=${state}`
}

// True (once) when `state` is one this app is waiting for. A success ends every pending sign-in.
export function acceptDesktopSignIn(state: string | null) {
  if (!state || !readPending().some((p) => p.state === state)) return false
  localStorage.removeItem(STATE_KEY)
  return true
}

// DesktopBridge tells the login page when a sign-in link was turned down (expired or not this app's).
export const SIGN_IN_REJECTED_EVENT = '9drive:desktop-sign-in-rejected'
