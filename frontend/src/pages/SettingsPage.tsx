import { useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { PageHeader } from '@/components/drive/PageHeader'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'
import { apiFetch } from '@/lib/api'
import { getStoredUser, updateStoredUser, type AuthUser } from '@/lib/auth'
import { logout } from '@/lib/session'
import { getGravatarUrl } from '@/lib/gravatar'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'

function Section({ title, badge, description, children }: { title: string; badge?: ReactNode; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-6 first:border-t-0 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {badge}
        </div>
        {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[13px] font-medium text-text">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  )
}

export function SettingsPage() {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser)
  const navigate = useNavigate()
  const { setBreadcrumb, setHeaderActions } = useDriveLayoutActions()
  const [themePref, setThemePref] = useState<ThemePreference>(getThemePreference)
  const isAdmin = user?.role === 'admin'
  const [message, setMessage] = useState('')
  const [profileImageUrl, setProfileImageUrl] = useState('')
  const [avatarError, setAvatarError] = useState(false)
  const [updatingSystem, setUpdatingSystem] = useState(false)
  const [updateModalOpen, setUpdateModalOpen] = useState(false)
  const [updateModalTitle, setUpdateModalTitle] = useState('')

  // Google OAuth Config states
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [googleRedirectUri, setGoogleRedirectUri] = useState('')
  const [defaultRedirectUri, setDefaultRedirectUri] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  const [savingGoogleConfig, setSavingGoogleConfig] = useState(false)

  // Live log polling states
  const [isPollingLog, setIsPollingLog] = useState(false)
  const [updateLog, setUpdateLog] = useState('')
  const [updateFinished, setUpdateFinished] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null)
  const [reconnectCount, setReconnectCount] = useState(0)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isPollingLog) return

    let intervalId: any
    let active = true

    async function fetchLog() {
      try {
        const data = await apiFetch<{ log: string }>('/system/update-log')
        if (!active) return

        setUpdateLog(data.log)
        setReconnectCount(0)

        if (data.log.includes('=== System Update Completed:')) {
          setUpdateFinished(true)
          setUpdateSuccess(true)
          setIsPollingLog(false)
          setUpdateModalTitle('System Updated')
          loadAppVersion()
        } else if (data.log.includes('=== System Update Failed:')) {
          setUpdateFinished(true)
          setUpdateSuccess(false)
          setIsPollingLog(false)
          setUpdateModalTitle('System Update Failed')
        }
      } catch (err) {
        if (!active) return
        setReconnectCount((prev) => prev + 1)
      }
    }

    fetchLog()
    intervalId = setInterval(fetchLog, 2000)

    return () => {
      active = false
      clearInterval(intervalId)
    }
  }, [isPollingLog])

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [updateLog])

  function loadAppVersion() {
    apiFetch<{ version?: string }>('/health', { skipAuth: true })
      .then((data) => setAppVersion(data.version ?? null))
      .catch(() => undefined)
  }

  useEffect(() => {
    if (isAdmin) loadAppVersion()
  }, [isAdmin])

  async function runSystemUpdate() {
    setUpdatingSystem(true)
    setMessage('')
    setUpdateLog('Initiating system update in the background...\n')
    setUpdateFinished(false)
    setUpdateSuccess(null)
    setReconnectCount(0)
    setUpdateModalTitle('System Updating')
    setUpdateModalOpen(true)

    try {
      await apiFetch<{ message: string }>('/system/update', { method: 'POST' })
      setIsPollingLog(true)
    } catch (error) {
      setUpdateModalTitle('System Update Failed')
      const errMsg = error instanceof Error ? error.message : 'System update failed to initiate.'
      setUpdateLog((prev) => prev + `\nError: ${errMsg}`)
      setUpdateFinished(true)
      setUpdateSuccess(false)
    } finally {
      setUpdatingSystem(false)
    }
  }

  async function saveGoogleConfig(event: FormEvent) {
    event.preventDefault()
    setSavingGoogleConfig(true)
    setMessage('')
    try {
      const res = await apiFetch<{ message: string }>('/system/google-config', {
        method: 'POST',
        body: JSON.stringify({
          clientId: googleClientId,
          clientSecret: googleClientSecret || undefined,
          redirectUri: googleRedirectUri || undefined,
        }),
      })
      setMessage(res.message || 'Google OAuth credentials saved.')
      setHasSecret(true)
      setGoogleClientSecret('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save Google OAuth configuration')
    } finally {
      setSavingGoogleConfig(false)
    }
  }

  async function load() {
    if (!isAdmin) return
    try {
      const configData = await apiFetch<{ exists: boolean; clientId: string; redirectUri: string; hasSecret: boolean; defaultRedirectUri: string }>('/system/google-config')
      if (configData.exists) {
        setGoogleClientId(configData.clientId || '')
        setGoogleRedirectUri(configData.redirectUri || '')
        setHasSecret(configData.hasSecret || false)
      }
      setDefaultRedirectUri(configData.defaultRedirectUri || '')
    } catch (e) {
      console.error('Failed to load global Google config', e)
    }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load settings'))
  }, [isAdmin])

  useEffect(() => {
    setBreadcrumb([{ label: 'Settings' }])
    setHeaderActions(null)
    // Stored sessions from before roles existed have no role; refresh it so admins see their sections.
    apiFetch<{ user: AuthUser }>('/auth/me')
      .then((data) => {
        updateStoredUser(data.user)
        setUser(data.user)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    setAvatarError(false)
    getGravatarUrl(user?.email, 96).then(setProfileImageUrl).catch(() => setProfileImageUrl(''))
  }, [user?.email])

  function closeUpdateDialog() {
    if (!updateFinished && !confirm('The update is still running in the background. Close log viewer?')) return
    setUpdateModalOpen(false)
    setIsPollingLog(false)
    if (updateFinished && updateSuccess) window.location.reload()
  }

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase()

  return (
    <>
      <PageHeader title="Settings" description="Manage your account, appearance and system." />
      <div className="mt-4 max-w-[800px]">
        {message ? <p role="status" className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-text">{message}</p> : null}

        <Section title="Profile">
          <div className="flex items-center gap-3.5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-selected text-lg font-semibold text-text">
              {profileImageUrl && !avatarError ? (
                <img src={profileImageUrl} alt="" className="h-full w-full object-cover" onError={() => setAvatarError(true)} />
              ) : (
                initial
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">{user?.name ?? 'User'}</p>
              <p className="truncate text-[13px] text-muted">{user?.email ?? '-'}{user?.role ? ` · ${user.role === 'admin' ? 'Admin' : 'User'}` : ''}</p>
            </div>
            <Button variant="secondary" onClick={() => logout(navigate)}><LogOut className="h-4 w-4" strokeWidth={1.5} />Sign out</Button>
          </div>
        </Section>

        <Section title="Appearance" description="Choose how 9Drive looks.">
          <Segmented<ThemePreference>
            value={themePref}
            onChange={(next) => { setThemePref(next); setThemePreference(next) }}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Section>

        {isAdmin ? (
          <>
            <Section title="Google sign-in" badge={<Badge>Admin</Badge>} description="OAuth credentials used for Google sign-in and Drive.">
              <form onSubmit={saveGoogleConfig} className="grid gap-4">
                <Field label="Client ID">
                  <Input placeholder="Google client ID" value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} required />
                </Field>
                <Field label="Client secret">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={hasSecret ? 'Saved. Leave blank to keep it' : 'Google client secret'}
                    value={googleClientSecret}
                    onChange={(e) => setGoogleClientSecret(e.target.value)}
                    required={!hasSecret}
                  />
                </Field>
                <Field
                  label="Redirect URI"
                  hint={<>Leave blank to use the default. Add this exact URL under Authorized redirect URIs in <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google Cloud Console</a>.</>}
                >
                  <Input placeholder={defaultRedirectUri} value={googleRedirectUri} onChange={(e) => setGoogleRedirectUri(e.target.value)} />
                </Field>
                <div>
                  <Button type="submit" disabled={savingGoogleConfig}>{savingGoogleConfig ? 'Saving...' : 'Save'}</Button>
                </div>
              </form>
            </Section>

            <Section title="System update" badge={<Badge>Admin</Badge>} description={`Pull the latest code from GitHub, rebuild, and restart.${appVersion ? ` Current version ${appVersion}.` : ''}`}>
              <Button variant="secondary" onClick={runSystemUpdate} disabled={updatingSystem}>
                <RefreshCw className={updatingSystem ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} strokeWidth={1.5} />
                {updatingSystem ? 'Updating...' : 'Update now'}
              </Button>
            </Section>
          </>
        ) : null}
      </div>

      <Dialog
        open={updateModalOpen}
        title={updateModalTitle}
        width={672}
        onClose={closeUpdateDialog}
        footer={
          <>
            <Button variant="secondary" onClick={closeUpdateDialog}>Close</Button>
            {updateFinished && updateSuccess ? <Button onClick={() => window.location.reload()}>Reload page</Button> : null}
          </>
        }
      >
        <p className="mb-3 text-[13px] text-muted">{updateFinished ? (updateSuccess ? 'System updated successfully' : 'Update failed') : 'Live installation logs'}</p>
        <div
          ref={logContainerRef}
          className="h-80 select-text overflow-y-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-text"
        >
          <pre className="whitespace-pre-wrap">{updateLog}</pre>
          {!updateFinished && (
            <div className="mt-3 flex items-center gap-2 text-muted">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              <span>
                {reconnectCount > 0 ? `Rebooting server and reconnecting... (attempt ${reconnectCount})` : 'Installing updates...'}
              </span>
            </div>
          )}
        </div>
      </Dialog>
    </>
  )
}
