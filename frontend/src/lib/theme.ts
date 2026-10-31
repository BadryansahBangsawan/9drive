export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = '9drive:theme'
const QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return pref
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

export function getThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // storage unavailable
  }
  return 'system'
}

function applyTheme(pref: ThemePreference) {
  const resolved = resolveTheme(pref, systemPrefersDark())
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // storage unavailable; still apply for this session
  }
  applyTheme(pref)
}

export function initTheme(): () => void {
  applyTheme(getThemePreference())
  let mql: MediaQueryList
  try {
    mql = window.matchMedia(QUERY)
  } catch {
    return () => {}
  }
  const onChange = () => applyTheme(getThemePreference())
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
