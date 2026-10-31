import { NavLink } from 'react-router-dom'
import { Braces, FileArchive, Gauge, History, Plus, Settings, Share2, Trash2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/api'
import type { ConnectedAccount } from '@/lib/accounts'
import { cn } from '@/lib/utils'

const primaryNav = [
  { label: 'All files', icon: FileArchive, href: '/all-files' },
  { label: 'Recent', icon: Clock, href: '/recent' },
  { label: 'Shared', icon: Share2, href: '/shared' },
  { label: 'Trash', icon: Trash2, href: '/trash' },
]
const storageNav = [
  { label: 'Accounts & quota', icon: Gauge, href: '/quota' },
  { label: 'Activity', icon: History, href: '/activity' },
]
const footerNav = [
  { label: 'Settings', icon: Settings, href: '/settings' },
  { label: 'API keys', icon: Braces, href: '/api' },
]

function NavItem({ item, onNavigate }: { item: (typeof primaryNav)[number]; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          isActive ? 'bg-selected text-text' : 'text-muted hover:bg-hover hover:text-text',
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

function StorageMeter({ accounts }: { accounts: ConnectedAccount[] }) {
  const withStorage = accounts.filter((a) => a.storageAccount)
  const sum = (provider: string) =>
    withStorage.filter((a) => a.provider === provider).reduce((n, a) => n + Number(a.storageAccount?.usedBytes ?? 0), 0)
  const driveUsed = sum('google_drive')
  const s3Used = sum('s3')
  const used = withStorage.reduce((n, a) => n + Number(a.storageAccount?.usedBytes ?? 0), 0)
  const total = withStorage.reduce((n, a) => n + Number(a.storageAccount?.totalBytes ?? 0), 0)
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0)
  const percent = Math.round(pct(used))

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-text">Storage</span>
        <span className="tabular-nums text-muted">{percent}%</span>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-hover" role="img" aria-label={`Storage ${percent}% used`}>
        <div className="h-full bg-drive" style={{ width: `${pct(driveUsed)}%` }} />
        <div className="h-full bg-s3" style={{ width: `${pct(s3Used)}%` }} />
      </div>
      <p className="mt-2 text-xs tabular-nums text-muted">
        {formatBytes(used)} of {formatBytes(total)} · {withStorage.length} {withStorage.length === 1 ? 'account' : 'accounts'}
      </p>
    </div>
  )
}

export function Sidebar({ accounts, onUpload, onNavigate }: { accounts: ConnectedAccount[]; onUpload: () => void; onNavigate?: () => void }) {
  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-fg" aria-hidden="true">9</div>
        <span className="text-[15px] font-semibold text-text">9Drive</span>
      </div>
      <div className="px-3 pb-3">
        <Button size="lg" className="w-full" onClick={() => { onUpload(); onNavigate?.() }}>
          <Plus className="h-4 w-4" strokeWidth={1.5} />Upload
        </Button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3" aria-label="Main">
        {primaryNav.map((item) => <NavItem key={item.href} item={item} onNavigate={onNavigate} />)}
        <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-subtle">Storage</p>
        {storageNav.map((item) => <NavItem key={item.href} item={item} onNavigate={onNavigate} />)}
        <div className="mt-auto flex flex-col gap-0.5 pt-4">
          {footerNav.map((item) => <NavItem key={item.href} item={item} onNavigate={onNavigate} />)}
        </div>
      </nav>
      <div className="mt-3"><StorageMeter accounts={accounts} /></div>
    </aside>
  )
}
