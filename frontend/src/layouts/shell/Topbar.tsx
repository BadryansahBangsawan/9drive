import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AuthUser } from '@/lib/auth'
import type { ConnectedAccount } from '@/lib/accounts'
import { AvatarMenu } from './AvatarMenu'
import { SearchFilters } from './SearchFilters'

export type BreadcrumbItem = { label: string; href?: string }

export function Topbar({
  breadcrumb,
  headerActions,
  accounts,
  user,
  onOpenMenu,
  onLogout,
}: {
  breadcrumb: BreadcrumbItem[]
  headerActions: ReactNode
  accounts: ConnectedAccount[]
  user: AuthUser | null
  onOpenMenu: () => void
  onLogout: () => void
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg px-4 lg:px-7">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={onOpenMenu}>
        <Menu className="h-4 w-4" strokeWidth={1.5} />
      </Button>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 md:block">
        <ol className="flex items-center gap-1 text-[13px]">
          {breadcrumb.map((item, i) => {
            const last = i === breadcrumb.length - 1
            return (
              <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" strokeWidth={1.5} />}
                {item.href && !last ? (
                  <Link to={item.href} className="truncate text-muted hover:text-text">{item.label}</Link>
                ) : (
                  <span className={last ? 'truncate font-medium text-text' : 'truncate text-muted'} aria-current={last ? 'page' : undefined}>{item.label}</span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
      <div className="flex min-w-0 flex-1 justify-end md:flex-none">
        <SearchFilters accounts={accounts} />
      </div>
      {headerActions ? <div className="hidden shrink-0 items-center gap-2 lg:flex">{headerActions}</div> : null}
      <AvatarMenu user={user} onLogout={onLogout} />
    </header>
  )
}
