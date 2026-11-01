// Where to go after signing in (?next=…), e.g. back to /desktop-auth when the desktop app sent the
// user here. Only same-site paths are followed.
const NEXT_KEY = '9drive:next'

export function safeNext(value: string | null | undefined) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null
}

// Google sign-in leaves the page; keep `next` for when it comes back (GoogleAuthPage).
export function rememberNext(next: string | null) {
  try {
    if (next) sessionStorage.setItem(NEXT_KEY, next)
    else sessionStorage.removeItem(NEXT_KEY)
  } catch { /* storage unavailable */ }
}

export function takeNext() {
  try {
    const next = safeNext(sessionStorage.getItem(NEXT_KEY))
    sessionStorage.removeItem(NEXT_KEY)
    return next
  } catch {
    return null
  }
}

export function withNext(path: string, next: string | null) {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path
}
