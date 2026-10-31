import { useEffect, useState } from 'react'
import { Check, File as FileIconGeneric, Folder, Link2, MoreHorizontal, Users, X } from 'lucide-react'
import { FileIcon } from '@/components/drive/FileIcon'
import { PageHeader } from '@/components/drive/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Menu, MenuItem } from '@/components/ui/menu'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

type InviteTarget = { id: string; name: string; type: 'file' | 'folder' }
type Invite = {
  id: string
  email: string
  role: string
  status: string
  targetType: 'file' | 'folder'
  targetId: string
  target: InviteTarget | null
}
type Share = {
  id: string
  url: string | null
  createdAt: string
  expiresAt: string | null
  file: { id: string; name: string; mimeType: string }
}

function kindOf(mimeType: string) {
  if (mimeType.startsWith('image/')) return 'image' as const
  if (mimeType.startsWith('video/')) return 'video' as const
  if (mimeType.includes('pdf')) return 'pdf' as const
  return 'doc' as const
}

function expiryText(expiresAt: string | null) {
  if (!expiresAt) return 'Never expires'
  return `Expires ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(expiresAt))}`
}

function initials(email: string) {
  return (email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || '?').toUpperCase()
}

export function SharedPage() {
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [shares, setShares] = useState<Share[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [received, setReceived] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  async function load() {
    try {
      const [links, inv] = await Promise.all([
        apiFetch<{ shares: Share[] }>('/files/shared-links'),
        apiFetch<{ sent: Invite[]; received: Invite[] }>('/invites'),
      ])
      setShares(links.shares)
      setInvites(inv.sent)
      setReceived(inv.received ?? [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load shared items')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setBreadcrumb([{ label: 'Shared' }])
    setHeaderActions(null)
    load()
    window.addEventListener('9drive:invites-changed', load)
    return () => window.removeEventListener('9drive:invites-changed', load)
  }, [])

  const [toRevoke, setToRevoke] = useState<Share | null>(null)
  const [revoking, setRevoking] = useState(false)

  async function copyLink(share: Share) {
    if (!share.url) return
    setMessage('')
    try {
      await navigator.clipboard.writeText(share.url)
      setCopiedId(share.id)
      window.setTimeout(() => setCopiedId((current) => (current === share.id ? null : current)), 1500)
    } catch {
      setMessage('Could not copy the link.')
    }
  }

  async function revokeLink(share: Share) {
    if (revoking) return
    setMessage('')
    setRevoking(true)
    try {
      await apiFetch(`/files/${share.file.id}/share`, { method: 'DELETE' })
      setShares((prev) => prev.filter((s) => s.id !== share.id))
      setToRevoke(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to revoke link')
      setToRevoke(null)
    } finally {
      setRevoking(false)
    }
  }

  async function revokeInvite(id: string) {
    setMenu(null)
    setMessage('')
    try {
      await apiFetch(`/invites/${id}`, { method: 'DELETE' })
      setInvites((prev) => prev.filter((i) => i.id !== id))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to revoke invite')
    }
  }

  const menuInvite = invites.find((i) => i.id === menu?.id)

  return (
    <>
      <PageHeader title="Shared" description="Public links and invites you have created." />
      {message ? (
        <p role="alert" className="mt-4 rounded-[10px] border border-danger px-3 py-2 text-[13px] text-danger">{message}</p>
      ) : null}
      {loading ? (
        <p className="mt-10 text-center text-[13px] text-muted">Loading shared items…</p>
      ) : (
        <div className="mt-6 space-y-8">
          <section aria-labelledby="public-links">
            <h2 id="public-links" className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Public links</h2>
            {shares.length === 0 ? (
              <EmptyState icon={<Link2 className="h-4 w-4" strokeWidth={1.5} />} title="No public links" description="Turn on a public link from a file's Share dialog and it will show up here." />
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {shares.map((share) => (
                  <li key={share.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 hover:bg-hover">
                    <FileIcon kind={kindOf(share.file.mimeType)} />
                    <span className="min-w-0 flex-1 basis-40 truncate text-[13px] font-medium text-text" title={share.file.name}>{share.file.name}</span>
                    <button
                      type="button"
                      onClick={() => copyLink(share)}
                      disabled={!share.url}
                      title={share.url ?? undefined}
                      aria-label={`Copy link for ${share.file.name}`}
                      className="inline-flex h-7 min-w-0 max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface px-2 font-mono text-[12px] text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                    >
                      {copiedId === share.id ? <Check className="h-3.5 w-3.5 shrink-0 text-drive" strokeWidth={1.5} aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
                      <span className="truncate">{copiedId === share.id ? 'Copied' : (share.url ?? '').replace(/^https?:\/\//, '')}</span>
                    </button>
                    <span className="w-28 text-[13px] tabular-nums text-muted">{expiryText(share.expiresAt)}</span>
                    <Button variant="ghost" size="sm" onClick={() => setToRevoke(share)}>Revoke</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="invites">
            <h2 id="invites" className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Invites</h2>
            {invites.length === 0 ? (
              <EmptyState icon={<Users className="h-4 w-4" strokeWidth={1.5} />} title="No invites" description="Invite people to a file or folder from its Share dialog." />
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex min-h-12 items-center gap-3 px-2 py-1.5 hover:bg-hover">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-text" aria-hidden="true">{initials(invite.email)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={invite.email}>{invite.email}</span>
                    <span className="hidden min-w-0 max-w-[14rem] flex-1 truncate text-[13px] text-muted sm:block" title={invite.target?.name}>
                      {invite.targetType === 'folder' ? 'Folder' : 'File'} · {invite.target?.name ?? 'Unavailable'}
                    </span>
                    <Badge>{invite.role}</Badge>
                    <span className="flex w-20 items-center gap-1.5 text-[13px] capitalize text-muted">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', invite.status === 'accepted' ? 'bg-drive' : 'bg-subtle')} aria-hidden="true" />
                      {invite.status}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${invite.email}`}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenu({ id: invite.id, x: r.right - 200, y: r.bottom + 4 })
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="received">
            <h2 id="received" className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-subtle">Shared with you</h2>
            {received.length === 0 ? (
              <EmptyState icon={<Users className="h-4 w-4" strokeWidth={1.5} />} title="Nothing shared with you" description="Files and folders other people invite you to will show up here." />
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {received.map((invite) => (
                  <li key={invite.id} className="flex min-h-12 items-center gap-3 px-2 py-1.5 hover:bg-hover">
                    {invite.targetType === 'folder' ? <Folder className="h-4 w-4 shrink-0 text-folder" strokeWidth={1.5} aria-hidden="true" /> : <FileIconGeneric className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text" title={invite.target?.name}>{invite.target?.name ?? 'Unavailable'}</span>
                    <span className="hidden min-w-0 max-w-[14rem] flex-1 truncate text-[13px] text-muted sm:block">
                      {invite.targetType === 'folder' ? 'Folder' : 'File'} · {invite.target?.name ?? 'Unavailable'}
                    </span>
                    <Badge>{invite.role}</Badge>
                    <span className="flex w-20 items-center gap-1.5 text-[13px] capitalize text-muted">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', invite.status === 'accepted' ? 'bg-drive' : 'bg-subtle')} aria-hidden="true" />
                      {invite.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <Menu open={!!menu && !!menuInvite} x={menu?.x ?? 0} y={menu?.y ?? 0} onClose={() => setMenu(null)}>
        <MenuItem danger icon={<X className="h-4 w-4" strokeWidth={1.5} />} onSelect={() => menu && revokeInvite(menu.id)}>Revoke invite</MenuItem>
      </Menu>
      <Dialog
        open={toRevoke !== null}
        onClose={() => { if (!revoking) setToRevoke(null) }}
        title="Revoke public link?"
        footer={
          <>
            <Button variant="secondary" disabled={revoking} onClick={() => setToRevoke(null)}>Cancel</Button>
            <Button variant="danger" disabled={revoking} onClick={() => toRevoke && revokeLink(toRevoke)}>{revoking ? 'Revoking…' : 'Revoke link'}</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          Anyone with the link to {toRevoke?.file.name ?? 'this file'} will lose access. Sharing it again creates a new link; the old one won't work.
        </p>
      </Dialog>
    </>
  )
}
