import { apiFetch } from '@/lib/api'
import { clearAuthSession } from '@/lib/auth'

export async function logout(navigate: (to: string) => void) {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
  clearAuthSession()
  navigate('/login')
}
