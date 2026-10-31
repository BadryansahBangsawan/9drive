import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Cloud, Database, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Menu, MenuItem } from '@/components/ui/menu'
import { PageHeader } from '@/components/drive/PageHeader'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'
import { accountLabel } from '@/lib/accounts'
import { apiFetch, formatBytes } from '@/lib/api'
import { cn } from '@/lib/utils'

type ConnectedAccount = {
  id: string
  email: string
  displayName?: string | null
  provider: string
  status: string
  lastError?: string | null
  storageAccount?: { totalBytes: string | null; usedBytes: string; availableBytes: string | null; lastSyncedAt: string | null } | null
}
type RoutingMode = 'most_available' | 'round_robin' | 'priority'
type RoutingPolicy = { mode: RoutingMode; priorityAccountIds: string[] }

const DANGER_THRESHOLD = 85
const EMPTY_S3 = { name: '', bucket: '', region: 'us-east-1', endpoint: '', accessKeyId: '', secretAccessKey: '', forcePathStyle: false, quotaBytes: '' }

const ROUTING_OPTIONS: { mode: RoutingMode; title: string; description: string }[] = [
  { mode: 'most_available', title: 'Most free space', description: 'Send each upload to the account with the most free space.' },
  { mode: 'round_robin', title: 'Round robin', description: 'Rotate through accounts so usage stays even.' },
  { mode: 'priority', title: 'Priority order', description: 'Fill accounts in the order you set below.' },
]

function notifyStorageChanged() {
  window.dispatchEvent(new Event('9drive:storage-changed'))
}

function usedPercent(account: ConnectedAccount): number | null {
  const total = Number(account.storageAccount?.totalBytes ?? 0)
  if (!account.storageAccount?.totalBytes || !(total > 0)) return null
  return Math.min(100, Math.round((Number(account.storageAccount.usedBytes) / total) * 100))
}

function syncedAgo(value: string | null | undefined) {
  if (!value) return 'never synced'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'synced just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `synced ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `synced ${hours}h ago`
  return `synced ${Math.floor(hours / 24)}d ago`
}

function ProviderTile({ provider }: { provider: string }) {
  const Icon = provider === 's3' ? Database : Cloud
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface', provider === 's3' ? 'text-s3' : 'text-drive')} aria-hidden="true">
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </span>
  )
}

export function QuotaTrackerPage() {
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [loadFailed, setLoadFailed] = useState(false)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [policy, setPolicy] = useState<RoutingPolicy>({ mode: 'most_available', priorityAccountIds: [] })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ account: ConnectedAccount; x: number; y: number } | null>(null)
  const [toDisconnect, setToDisconnect] = useState<ConnectedAccount | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [s3Open, setS3Open] = useState(false)
  const [s3Form, setS3Form] = useState(EMPTY_S3)
  const [s3Error, setS3Error] = useState('')
  const [connectingS3, setConnectingS3] = useState(false)

  async function load() {
    const [accountData, policyData] = await Promise.all([
      apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts'),
      apiFetch<{ policy: RoutingPolicy }>('/storage/routing-policy'),
    ])
    setAccounts(accountData.accounts)
    setLoadFailed(false)
    setPolicy({ mode: policyData.policy.mode, priorityAccountIds: policyData.policy.priorityAccountIds })
  }

  useEffect(() => {
    setBreadcrumb([{ label: 'Accounts & quota' }])
    setHeaderActions(null)
    load()
      .catch((err) => { setLoadFailed(true); setError(err instanceof Error ? err.message : 'Failed to load accounts') })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== 'GOOGLE_CONNECTED') return
      if (event.data.status === 'success') {
        setError('')
        setMessage('Google Drive connected.')
      } else {
        setMessage('')
        setError('Google Drive connection failed.')
      }
      load().then(notifyStorageChanged).catch(() => undefined)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function connectDrive() {
    setConnecting(true)
    setError('')
    setMessage('')
    const popup = window.open('', 'google-drive-connect', 'width=540,height=720')
    if (popup) {
      popup.document.write('<html><head><title>Connecting...</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#64748b;}</style></head><body><div style="text-align:center;"><h2>Connecting to Google...</h2><p>Please wait while we redirect you.</p></div></body></html>')
    }
    try {
      const data = await apiFetch<{ url: string }>('/connected-accounts/google/connect-url')
      if (popup) popup.location.href = data.url
      else window.location.href = data.url
    } catch (err) {
      if (popup) popup.close()
      setError(err instanceof Error ? err.message : 'Failed to start Google Drive connection')
    } finally {
      setConnecting(false)
    }
  }

  async function connectS3(event: FormEvent) {
    event.preventDefault()
    setConnectingS3(true)
    setS3Error('')
    try {
      await apiFetch('/connected-accounts/s3', { method: 'POST', body: JSON.stringify({ ...s3Form, endpoint: s3Form.endpoint || undefined, quotaBytes: s3Form.quotaBytes || null }) })
      setS3Open(false)
      setS3Form(EMPTY_S3)
      setMessage('S3 storage connected.')
      await load()
      notifyStorageChanged()
    } catch (err) {
      setS3Error(err instanceof Error ? err.message : 'Failed to connect S3 storage')
    } finally {
      setConnectingS3(false)
    }
  }

  async function sync(accountId: string) {
    setSyncingId(accountId)
    setError('')
    try {
      await apiFetch(`/connected-accounts/${accountId}/sync-quota`, { method: 'POST' })
      await load()
      notifyStorageChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync quota')
    } finally {
      setSyncingId(null)
    }
  }

  async function disconnect() {
    if (!toDisconnect) return
    setDisconnecting(true)
    setError('')
    try {
      await apiFetch(`/connected-accounts/${toDisconnect.id}`, { method: 'DELETE' })
      setToDisconnect(null)
      setMessage('Storage account disconnected.')
      await load()
      notifyStorageChanged()
    } catch (err) {
      setToDisconnect(null)
      setError(err instanceof Error ? err.message : 'Failed to disconnect account')
    } finally {
      setDisconnecting(false)
    }
  }

  async function savePolicy(next: RoutingPolicy) {
    const previous = policy
    setPolicy(next)
    setError('')
    try {
      const data = await apiFetch<{ policy: RoutingPolicy }>('/storage/routing-policy', { method: 'PATCH', body: JSON.stringify({ mode: next.mode, priorityAccountIds: next.priorityAccountIds }) })
      setPolicy({ mode: data.policy.mode, priorityAccountIds: data.policy.priorityAccountIds })
      setMessage('Upload routing updated.')
    } catch (err) {
      setPolicy(previous)
      setError(err instanceof Error ? err.message : 'Failed to update routing policy')
    }
  }

  function orderedAccounts() {
    const byId = new Map(connected.map((a) => [a.id, a]))
    const ordered = policy.priorityAccountIds.map((id) => byId.get(id)).filter((a): a is ConnectedAccount => Boolean(a))
    const seen = new Set(ordered.map((a) => a.id))
    return [...ordered, ...connected.filter((a) => !seen.has(a.id))]
  }

  function move(accountId: string, direction: -1 | 1) {
    const ids = orderedAccounts().map((a) => a.id)
    const index = ids.indexOf(accountId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    const next = [...ids]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    savePolicy({ ...policy, priorityAccountIds: next }).catch(() => undefined)
  }

  const connected = accounts.filter((a) => a.status === 'connected')

  const connectActions = (
    <>
      <Button variant="secondary" onClick={() => { setS3Error(''); setS3Open(true) }}><Database className="h-4 w-4" strokeWidth={1.5} />Connect S3</Button>
      <Button onClick={connectDrive} disabled={connecting}><Cloud className="h-4 w-4" strokeWidth={1.5} />{connecting ? 'Opening...' : 'Connect Google Drive'}</Button>
    </>
  )

  const usedTotal = connected.reduce((sum, a) => sum + Number(a.storageAccount?.usedBytes ?? 0), 0)
  const unlimitedAny = connected.some((a) => a.storageAccount != null && a.storageAccount.totalBytes == null)
  const capacity = connected.reduce((sum, a) => sum + Number(a.storageAccount?.totalBytes ?? 0), 0)
  const freeTotal = connected.reduce((sum, a) => sum + Number(a.storageAccount?.availableBytes ?? 0), 0)
  const barBase = unlimitedAny ? usedTotal : Math.max(capacity, usedTotal)
  const ordered = orderedAccounts()

  return (
    <>
      <PageHeader title="Accounts & quota" description="Connected storage, capacity, and where new uploads go." actions={connectActions} />
      {error ? <p role="alert" className="mt-5 rounded-[10px] border border-danger px-4 py-3 text-[13px] text-danger">{error}</p> : null}
      {message ? <p role="status" className="mt-5 rounded-[10px] border border-border bg-surface px-4 py-3 text-[13px] text-text">{message}</p> : null}

      {loading ? (
        <p className="mt-10 text-center text-[13px] text-muted">Loading accounts…</p>
      ) : loadFailed ? null : accounts.length === 0 ? (
        <EmptyState
          icon={<Cloud className="h-4 w-4" strokeWidth={1.5} />}
          title="No connected storage"
          description="Connect Google Drive or S3-compatible storage to start uploading."
          action={<div className="flex flex-wrap justify-center gap-2">{connectActions}</div>}
        />
      ) : (
        <>
          <section aria-label="Summary" className="mt-6">
            <Card className="p-5">
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Used</p><p className="mt-1 text-[22px] font-semibold tabular-nums text-text">{formatBytes(usedTotal)}</p></div>
                <div><p className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Free</p><p className="mt-1 text-[22px] font-semibold tabular-nums text-text">{unlimitedAny ? 'Unlimited' : formatBytes(freeTotal)}</p></div>
                <div><p className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Total capacity</p><p className="mt-1 text-[22px] font-semibold tabular-nums text-text">{unlimitedAny ? 'Unlimited' : formatBytes(capacity)}</p></div>
              </div>
              <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-selected" role="img" aria-label="Usage by account">
                {barBase > 0 ? connected.map((a) => {
                  const width = (Number(a.storageAccount?.usedBytes ?? 0) / barBase) * 100
                  return width > 0 ? <span key={a.id} style={{ width: `${width}%` }} className={cn('h-full border-r border-bg last:border-r-0', a.provider === 's3' ? 'bg-s3' : 'bg-drive')} title={`${accountLabel(a)}: ${formatBytes(a.storageAccount?.usedBytes)}`} /> : null
                }) : null}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {connected.map((a) => (
                  <li key={a.id} className="flex min-w-0 max-w-full items-center gap-2 text-[12px] text-muted">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', a.provider === 's3' ? 'bg-s3' : 'bg-drive')} aria-hidden="true" />
                    <span className="truncate">{accountLabel(a)}</span>
                    <span className="tabular-nums text-subtle">{formatBytes(a.storageAccount?.usedBytes)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          <section aria-label="Accounts" className="mt-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Accounts</h2>
            <Card className="divide-y divide-border">
              {accounts.map((account) => {
                const percent = usedPercent(account)
                const danger = percent !== null && percent >= DANGER_THRESHOLD
                const synced = account.storageAccount != null
                const unlimited = synced && account.storageAccount?.totalBytes == null
                return (
                  <div key={account.id} className="flex items-center gap-3 px-4 py-3">
                    <ProviderTile provider={account.provider} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium text-text">{account.provider === 's3' ? account.displayName || account.email : 'Google Drive'}</p>
                        {account.status !== 'active' && account.status !== 'connected' ? <Badge>{account.status}</Badge> : null}
                      </div>
                      <p className="truncate text-[12px] text-muted" title={account.email}>{account.email} · {syncedAgo(account.storageAccount?.lastSyncedAt)}</p>
                      {account.lastError ? <p className="truncate text-[12px] text-danger" title={account.lastError}>{account.lastError}</p> : null}
                    </div>
                    <div className="w-auto shrink-0 sm:w-56">
                      <div className="hidden h-1.5 overflow-hidden rounded-full bg-selected sm:block">
                        {percent !== null ? <div className={cn('h-full rounded-full', danger ? 'bg-danger' : 'bg-primary')} style={{ width: `${percent}%` }} /> : null}
                      </div>
                      <p className={cn('text-right text-[12px] tabular-nums sm:mt-1 sm:text-left', danger ? 'text-danger' : 'text-muted')}>
                        {synced ? <>{formatBytes(account.storageAccount?.usedBytes)} / {unlimited ? 'Unlimited' : formatBytes(account.storageAccount?.totalBytes)}{percent !== null ? ` · ${percent}%` : ''}</> : 'Not synced yet'}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => sync(account.id)} disabled={syncingId === account.id}>
                      <RefreshCw className={cn('h-3.5 w-3.5', syncingId === account.id && 'animate-spin')} strokeWidth={1.5} />Sync
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`More actions for ${account.email}`}
                      aria-haspopup="menu"
                      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ account, x: r.right - 200, y: r.bottom + 4 }) }}
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                    </Button>
                  </div>
                )
              })}
            </Card>
          </section>

          <section aria-label="Upload routing" className="mt-6">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Upload routing</h2>
            <p className="mb-2 mt-0.5 text-[13px] text-muted">Choose how new uploads pick a storage account.</p>
            <div role="radiogroup" aria-label="Upload routing mode" className="grid gap-3 md:grid-cols-3">
              {ROUTING_OPTIONS.map((option) => {
                const selected = policy.mode === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => { if (!selected) savePolicy({ ...policy, mode: option.mode }).catch(() => undefined) }}
                    className={cn(
                      'rounded-[10px] border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      selected ? 'border-accent bg-accent-soft' : 'border-border bg-bg hover:bg-hover',
                    )}
                  >
                    <p className="text-[13px] font-medium text-text">{option.title}</p>
                    <p className="mt-1 text-[12px] text-muted">{option.description}</p>
                  </button>
                )
              })}
            </div>
            {policy.mode === 'priority' ? (
              <Card className="mt-3 divide-y divide-border">
                {ordered.map((account, index) => (
                  <div key={account.id} className="flex h-12 items-center gap-3 px-4">
                    <span className="w-5 text-[12px] tabular-nums text-subtle">{index + 1}</span>
                    <ProviderTile provider={account.provider} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-text" title={accountLabel(account)}>{accountLabel(account)}</span>
                    <Button variant="ghost" size="icon" aria-label={`Move ${accountLabel(account)} up`} onClick={() => move(account.id, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" strokeWidth={1.5} /></Button>
                    <Button variant="ghost" size="icon" aria-label={`Move ${accountLabel(account)} down`} onClick={() => move(account.id, 1)} disabled={index === ordered.length - 1}><ArrowDown className="h-4 w-4" strokeWidth={1.5} /></Button>
                  </div>
                ))}
              </Card>
            ) : null}
          </section>
        </>
      )}

      <Menu open={Boolean(menu)} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)}>
        <MenuItem icon={<Trash2 size={16} strokeWidth={1.5} />} danger onSelect={() => { setToDisconnect(menu?.account ?? null); setMenu(null) }}>Disconnect</MenuItem>
      </Menu>

      <Dialog
        open={Boolean(toDisconnect)}
        title="Disconnect storage?"
        onClose={() => setToDisconnect(null)}
        footer={<><Button variant="secondary" onClick={() => setToDisconnect(null)} disabled={disconnecting}>Cancel</Button><Button variant="danger" onClick={disconnect} disabled={disconnecting}>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</Button></>}
      >
        <p className="text-[13px] text-muted">
          This removes the account from 9Drive. Files stored there may no longer be available.
          {toDisconnect?.provider === 'google_drive' ? ' Its My Drive folder and the files imported from it leave 9Drive too; they stay in Google Drive.' : ''}
        </p>
        <p className="mt-3 truncate text-[13px] font-medium text-text" title={toDisconnect?.email}>{toDisconnect?.email}</p>
        <p className="mt-0.5 text-[12px] tabular-nums text-muted">Used: {formatBytes(toDisconnect?.storageAccount?.usedBytes)}</p>
      </Dialog>

      <Dialog
        open={s3Open}
        title="Connect S3 storage"
        onClose={() => setS3Open(false)}
        footer={<><Button variant="secondary" onClick={() => setS3Open(false)} disabled={connectingS3}>Cancel</Button><Button type="submit" form="s3-connect-form" disabled={connectingS3}>{connectingS3 ? 'Connecting...' : 'Connect S3'}</Button></>}
      >
        <p className="mb-3 text-[13px] text-muted">Use any S3-compatible provider with custom endpoint support.</p>
        <form id="s3-connect-form" className="grid gap-3" onSubmit={connectS3}>
          <Input aria-label="Display name" placeholder="Display name" value={s3Form.name} onChange={(e) => setS3Form({ ...s3Form, name: e.target.value })} required />
          <Input aria-label="Bucket" placeholder="Bucket" value={s3Form.bucket} onChange={(e) => setS3Form({ ...s3Form, bucket: e.target.value })} required />
          <Input aria-label="Region" placeholder="Region" value={s3Form.region} onChange={(e) => setS3Form({ ...s3Form, region: e.target.value })} required />
          <Input aria-label="Endpoint URL" placeholder="Endpoint URL (optional)" value={s3Form.endpoint} onChange={(e) => setS3Form({ ...s3Form, endpoint: e.target.value })} />
          <Input aria-label="Access key ID" placeholder="Access key ID" value={s3Form.accessKeyId} onChange={(e) => setS3Form({ ...s3Form, accessKeyId: e.target.value })} required />
          <Input aria-label="Secret access key" placeholder="Secret access key" type="password" value={s3Form.secretAccessKey} onChange={(e) => setS3Form({ ...s3Form, secretAccessKey: e.target.value })} required />
          <Input aria-label="Quota in bytes" placeholder="Quota bytes (optional)" inputMode="numeric" value={s3Form.quotaBytes} onChange={(e) => setS3Form({ ...s3Form, quotaBytes: e.target.value })} />
          <label className="flex items-center gap-2 text-[13px] text-text"><input type="checkbox" className="accent-accent" checked={s3Form.forcePathStyle} onChange={(e) => setS3Form({ ...s3Form, forcePathStyle: e.target.checked })} />Force path style</label>
          {s3Error ? <p role="alert" className="text-[13px] text-danger">{s3Error}</p> : null}
        </form>
      </Dialog>
    </>
  )
}
