import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getAccessToken } from '@/lib/auth'
import { withNext } from '@/lib/redirect'

// Signed out: to the sign-in page, which comes back here afterwards.
export function ProtectedRoute() {
  const location = useLocation()
  if (getAccessToken()) return <Outlet />
  const here = `${location.pathname}${location.search}`
  return <Navigate to={withNext('/login', here === '/' || here === '/all-files' ? null : here)} replace />
}
