// Desktop sign-in through the website. The app remembers a random state before opening
// <server>/desktop-auth?state=…, and only accepts a ninedrive://auth link carrying that state, so a
// link from anywhere else can't sign the app in to someone else's account.
const STATE_KEY = '9drive:desktop-auth-state'

function randomState() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Returns the website URL to open in the browser.
export function beginDesktopSignIn(server: string) {
  const state = randomState()
  localStorage.setItem(STATE_KEY, state)
  return `${server}/desktop-auth?state=${state}`
}

// True (once) when `state` is the one this app is waiting for.
export function acceptDesktopSignIn(state: string | null) {
  const expected = localStorage.getItem(STATE_KEY)
  if (!expected || state !== expected) return false
  localStorage.removeItem(STATE_KEY)
  return true
}
