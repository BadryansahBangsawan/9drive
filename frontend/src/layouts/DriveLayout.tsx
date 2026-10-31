import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { logout } from '@/lib/session'
import { getStoredUser, updateStoredUser, type AuthUser } from '@/lib/auth'
import type { ConnectedAccount } from '@/lib/accounts'
import { cn } from '@/lib/utils'
import { Sidebar } from './shell/Sidebar'
import { Topbar, type BreadcrumbItem } from './shell/Topbar'
import { UploadDialog } from '@/components/drive/UploadDialog'
import { UploadPanel } from './shell/UploadPanel'

export type DriveLayoutContext = {
  setHeaderActions: (actions: ReactNode) => void
  setBreadcrumb: (items: BreadcrumbItem[]) => void
  openUpload: (folderId?: string | null) => void
}

export function useDriveLayoutActions() {
  return useOutletContext<DriveLayoutContext>()
}

const pageNames: Record<string, string> = {
  '/all-files': 'All files',
  '/recent': 'Recent',
  '/shared': 'Shared',
  '/trash': 'Trash',
  '/quota': 'Accounts & quota',
  '/activity': 'Activity',
  '/settings': 'Settings',
  '/api': 'API keys',
}

export function DriveLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(getStoredUser())
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [headerActions, setHeaderActions] = useState<ReactNode>(null)
  // Remember which route a page-provided breadcrumb belongs to so it never leaks onto another page.
  const [custom, setCustom] = useState<{ path: string; items: BreadcrumbItem[] } | null>(null)

  const setBreadcrumb = useCallback(
    (items: BreadcrumbItem[]) => setCustom({ path: window.location.pathname, items }),
    [],
  )
  const [uploadTarget, setUploadTarget] = useState<{ open: boolean; folderId: string | null }>({ open: false, folderId: null })
  const openUpload = useCallback(
    (folderId?: string | null) => {
      const target = folderId !== undefined ? folderId : location.pathname === '/all-files' ? new URLSearchParams(location.search).get('folderId') : null
      setUploadTarget({ open: true, folderId: target })
    },
    [location.pathname, location.search],
  )

  const breadcrumb =
    custom && custom.path === location.pathname
      ? custom.items
      : [{ label: pageNames[location.pathname] ?? 'All files' }]

  const loadAccounts = useCallback(async () => {
    try {
      const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
      setAccounts(data.accounts)
    } catch (e) {
      console.error('Failed to load connected accounts', e)
    }
  }, [])

  useEffect(() => {
    apiFetch<{ user: AuthUser }>('/auth/me')
      .then((data) => {
        setUser(data.user)
        updateStoredUser(data.user)
      })
      .catch(() => undefined)
    loadAccounts()
    window.addEventListener('9drive:storage-changed', loadAccounts)
    return () => window.removeEventListener('9drive:storage-changed', loadAccounts)
  }, [loadAccounts])

  useEffect(() => {
    if (!drawerOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  function handleLogout() {
    return logout(navigate)
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      <div className="hidden w-[248px] shrink-0 lg:block">
        <Sidebar accounts={accounts} onUpload={openUpload} />
      </div>

      <div
        className={cn('fixed inset-0 z-40 bg-text/40 transition-opacity lg:hidden', drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[248px] max-w-[85vw] transition-transform duration-200 ease-out lg:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        inert={!drawerOpen}
      >
        <Sidebar accounts={accounts} onUpload={openUpload} onNavigate={() => setDrawerOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          breadcrumb={breadcrumb}
          headerActions={headerActions}
          accounts={accounts}
          user={user}
          onOpenMenu={() => setDrawerOpen(true)}
          onLogout={handleLogout}
        />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 lg:p-7">
          <Outlet context={{ setHeaderActions, setBreadcrumb, openUpload } satisfies DriveLayoutContext} />
        </main>
      </div>

      <UploadDialog open={uploadTarget.open} folderId={uploadTarget.folderId} onClose={() => setUploadTarget((current) => ({ ...current, open: false }))} />
      <UploadPanel />
    </div>
  )
}
