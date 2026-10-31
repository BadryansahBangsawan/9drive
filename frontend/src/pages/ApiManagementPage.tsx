import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/drive/PageHeader'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'
import { API_URL, apiFetch, formatDate } from '@/lib/api'

type ApiKey = { id: string; name: string; keyPrefix: string; scopes: string[]; status: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string }

const curlExample = `curl -X POST "${API_URL}/api/v1/uploads" \\
  -H "Authorization: Bearer 9d_live_xxx" \\
  -F 'filesMeta=[{"fieldName":"file-0","fileName":"hello.txt","mimeType":"text/plain","sizeBytes":"12"}]' \\
  -F "file-0=@hello.txt;type=text/plain"`

const jsExample = `const form = new FormData()
form.append('filesMeta', JSON.stringify([
  { fieldName: 'file-0', fileName: file.name, mimeType: file.type, sizeBytes: String(file.size) },
]))
form.append('file-0', file)

await fetch('${API_URL}/api/v1/uploads', {
  method: 'POST',
  headers: { Authorization: 'Bearer 9d_live_xxx' },
  body: form,
})`

function CopyIcon({ active }: { active: boolean }) {
  return active ? <Check className="h-4 w-4" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />
}

export function ApiManagementPage() {
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loaded, setLoaded] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [expiry, setExpiry] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState('')
  const [loading, setLoading] = useState(false)
  const [lang, setLang] = useState<'curl' | 'js'>('curl')
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)

  async function load() {
    const data = await apiFetch<{ apiKeys: ApiKey[] }>('/api-keys')
    setApiKeys(data.apiKeys)
    setLoaded(true)
  }

  useEffect(() => {
    setBreadcrumb([{ label: 'API keys' }])
    setHeaderActions(null)
    load().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load API keys'))
  }, [])

  async function createKey(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const expiresAt = expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null
      const data = await apiFetch<{ apiKey: ApiKey; secret: string }>('/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName, expiresAt }) })
      setSecret(data.secret)
      setKeyName('')
      setExpiry('')
      setCreateOpen(false)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create API key')
    } finally {
      setLoading(false)
    }
  }

  async function revokeKey() {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await apiFetch(`/api-keys/${revokeTarget.id}`, { method: 'DELETE' })
      setRevokeTarget(null)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to revoke API key')
      setRevokeTarget(null)
    } finally {
      setRevoking(false)
    }
  }

  function copy(id: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(id)
      setTimeout(() => setCopied((cur) => (cur === id ? '' : cur)), 1500)
    }).catch(() => setMessage('Failed to copy.'))
  }

  const example = lang === 'curl' ? curlExample : jsExample
  const newKeyButton = <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" strokeWidth={1.5} />Create key</Button>

  return (
    <>
      <PageHeader title="API keys" description="Keys can only upload files. Secrets are shown once and never stored." actions={newKeyButton} />
      {message ? <p role="status" className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-text">{message}</p> : null}

      {secret ? (
        <div className="mt-4 rounded-[10px] border border-border bg-accent-soft p-4">
          <p className="text-sm font-semibold text-text">Copy your new key</p>
          <p className="mt-0.5 text-[13px] text-muted">This is the only time it is shown. Store it somewhere safe.</p>
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
            <code className="block min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[13px] text-text">{secret}</code>
            <Button onClick={() => copy('secret', secret)}><CopyIcon active={copied === 'secret'} />{copied === 'secret' ? 'Copied' : 'Copy'}</Button>
            <Button variant="ghost" onClick={() => setSecret('')}>Dismiss</Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-[10px] border border-border">
        {loaded && apiKeys.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-5 w-5" strokeWidth={1.5} />}
            title="No API keys yet"
            description="Create a key to upload files from scripts and other apps."
            action={newKeyButton}
          />
        ) : (
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-muted">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Key prefix</th>
                <th className="px-4 py-2.5 font-medium">Scope</th>
                <th className="px-4 py-2.5 font-medium">Last used</th>
                <th className="px-4 py-2.5 font-medium">Expires</th>
                <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((apiKey) => (
                <tr key={apiKey.id} className="h-12 border-b border-border last:border-b-0">
                  <td className="px-4 font-medium text-text">
                    {apiKey.name}
                    {apiKey.status !== 'active' ? <span className="ml-2 text-xs font-normal text-subtle">{apiKey.status}</span> : null}
                  </td>
                  <td className="px-4 font-mono text-xs text-muted">{apiKey.keyPrefix}...</td>
                  <td className="px-4"><Badge tone="mono">{apiKey.scopes.join(', ')}</Badge></td>
                  <td className="px-4 tabular-nums text-muted">{apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never'}</td>
                  <td className="px-4 tabular-nums text-muted">{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}</td>
                  <td className="px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(apiKey)}
                      disabled={apiKey.status === 'revoked'}
                      className="rounded-md px-2 py-1 text-[13px] font-medium text-danger transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text">Quick start</h2>
            <p className="mt-0.5 text-[13px] text-muted">Upload a file with <span className="font-mono text-xs">POST /api/v1/uploads</span> and your key as a Bearer token.</p>
          </div>
          <div className="flex items-center gap-2">
            <Segmented<'curl' | 'js'> value={lang} onChange={setLang} options={[{ value: 'curl', label: 'cURL' }, { value: 'js', label: 'JavaScript' }]} />
            <Button variant="secondary" size="sm" onClick={() => copy('example', example)}><CopyIcon active={copied === 'example'} />{copied === 'example' ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
        <pre className="mt-3 max-w-full overflow-auto rounded-[10px] border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text">{example}</pre>
      </section>

      <Dialog
        open={revokeTarget !== null}
        title="Revoke this key?"
        width={400}
        onClose={() => { if (!revoking) setRevokeTarget(null) }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)} disabled={revoking}>Cancel</Button>
            <Button variant="danger" onClick={revokeKey} disabled={revoking}>{revoking ? 'Revoking...' : 'Revoke'}</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">Revoke this key? Apps using it will stop working.</p>
      </Dialog>

      <Dialog
        open={createOpen}
        title="Create API key"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" form="create-key-form" disabled={loading}>{loading ? 'Creating...' : 'Create key'}</Button>
          </>
        }
      >
        <form id="create-key-form" className="grid gap-4" onSubmit={createKey}>
          <label className="grid gap-1.5 text-[13px] font-medium text-text">
            Name
            <Input placeholder="e.g. Backup script" value={keyName} onChange={(e) => setKeyName(e.target.value)} required />
          </label>
          <label className="grid gap-1.5 text-[13px] font-medium text-text">
            Expires (optional)
            <Input type="date" value={expiry} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExpiry(e.target.value)} />
            <span className="text-xs font-normal text-muted">Leave empty for a key that never expires.</span>
          </label>
        </form>
      </Dialog>
    </>
  )
}
