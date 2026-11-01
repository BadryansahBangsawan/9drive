import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { LogoLockup } from '@/components/brand/Logo'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatBytes, formatDate } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import { cn } from '@/lib/utils'

// Installers come from the latest GitHub release of the desktop app (.github/workflows/desktop.yml).
const RELEASES_REPO = import.meta.env.VITE_DESKTOP_RELEASES_REPO?.trim() || 'BadryansahBangsawan/9drive'
const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`

type Asset = { name: string; size: number; browser_download_url: string }
type Release = { tag_name: string; published_at: string; html_url: string; assets: Asset[] }
type Platform = 'mac' | 'windows' | 'linux'
type Installer = { platform: Platform; label: string; note: string; pattern: RegExp }

// File names tauri-action gives the installers.
const installers: Installer[] = [
  { platform: 'mac', label: 'macOS · Apple Silicon', note: 'M1 and newer', pattern: /_aarch64\.dmg$/ },
  { platform: 'mac', label: 'macOS · Intel', note: 'Intel Macs', pattern: /_x64\.dmg$/ },
  { platform: 'windows', label: 'Windows', note: 'Installer (.exe)', pattern: /-setup\.exe$/ },
  { platform: 'windows', label: 'Windows', note: 'MSI package', pattern: /\.msi$/ },
  { platform: 'linux', label: 'Linux', note: 'AppImage, any distribution', pattern: /\.AppImage$/ },
  { platform: 'linux', label: 'Linux', note: 'Debian / Ubuntu (.deb)', pattern: /\.deb$/ },
  { platform: 'linux', label: 'Linux', note: 'Fedora / openSUSE (.rpm)', pattern: /\.rpm$/ },
]

const platformNames: Record<Platform, string> = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }

function detectPlatform(): Platform | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const value = `${nav.userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (value.includes('mac')) return 'mac'
  if (value.includes('win')) return 'windows'
  if (value.includes('linux') && !value.includes('android')) return 'linux'
  return null
}

export function DownloadAppPage() {
  const [release, setRelease] = useState<Release | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const platform = detectPlatform()

  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(async (response) => {
        if (cancelled) return
        if (response.status === 404) return setState('none')
        if (!response.ok) return setState('error')
        setRelease(await response.json() as Release)
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const available = installers
    .map((installer) => ({ installer, asset: release?.assets.find((asset) => installer.pattern.test(asset.name)) }))
    .filter((entry): entry is { installer: Installer; asset: Asset } => !!entry.asset)
  const recommended = available.find((entry) => entry.installer.platform === platform)
  const backTo = getAccessToken() ? '/all-files' : '/login'

  return (
    <div className="min-h-screen bg-surface">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <LogoLockup className="h-6" />
        <Link to={backTo} className={cn(buttonVariants({ variant: 'ghost' }))}><ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Back to 9Drive</Link>
      </header>
      <main className="mx-auto grid max-w-3xl gap-6 px-5 pb-16">
        <section className="pt-6">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">9Drive for desktop</h1>
          <p className="mt-2 max-w-xl text-[14px] text-muted">The same 9Drive, made for big files. Uploads go straight from your computer to Google Drive or S3, keep going after sleep, a dropped connection or a restart, and downloads save straight to disk.</p>
          {recommended ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href={recommended.asset.browser_download_url} className={cn(buttonVariants({ size: 'lg' }), 'h-10 px-5 text-[14px]')}>
                <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />Download for {recommended.installer.label.replace(' · ', ' (')}{recommended.installer.label.includes(' · ') ? ')' : ''}
              </a>
              <span className="text-[13px] text-muted">{formatBytes(recommended.asset.size)} · {release?.tag_name.replace(/^desktop-/, '')}</span>
            </div>
          ) : null}
        </section>

        {state === 'loading' ? <p className="text-[13px] text-muted" role="status">Looking for the latest release…</p> : null}
        {state === 'none' || (state === 'ready' && available.length === 0) ? (
          <Card className="p-5 text-[13px] text-muted">The desktop app hasn’t been released yet. Check back soon.</Card>
        ) : null}
        {state === 'error' ? (
          <Card className="p-5 text-[13px] text-muted">
            Couldn’t load the downloads right now. <a className="font-medium text-accent hover:underline" href={RELEASES_PAGE} target="_blank" rel="noreferrer">See all releases on GitHub</a>.
          </Card>
        ) : null}

        {available.length > 0 ? (
          <section aria-labelledby="all-downloads">
            <h2 id="all-downloads" className="text-[13px] font-medium text-text">All downloads</h2>
            <Card className="mt-2 divide-y divide-border p-0">
              {available.map(({ installer, asset }) => (
                <div key={asset.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-text">{installer.label}{installer.platform === platform ? <span className="ml-2 text-[12px] font-normal text-accent">Your system</span> : null}</p>
                    <p className="truncate text-[12px] text-muted" title={asset.name}>{installer.note} · {formatBytes(asset.size)}</p>
                  </div>
                  <a href={asset.browser_download_url} className={buttonVariants({ variant: 'secondary' })}>
                    <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />Download
                  </a>
                </div>
              ))}
            </Card>
            {release ? (
              <p className="mt-2 text-[12px] text-subtle">
                {release.tag_name.replace(/^desktop-/, '')} · released {formatDate(release.published_at)} · <a className="hover:underline" href={release.html_url} target="_blank" rel="noreferrer">Release notes</a>
              </p>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="first-launch" className="grid gap-2 text-[13px] text-muted">
          <h2 id="first-launch" className="text-[13px] font-medium text-text">First launch</h2>
          <p><span className="text-text">macOS:</span> open the .dmg and drag 9Drive to Applications. The first time, right-click 9Drive → Open, then Open again.</p>
          <p><span className="text-text">Windows:</span> if SmartScreen appears, choose More info → Run anyway.</p>
          <p><span className="text-text">Linux:</span> make the AppImage executable (chmod +x), or install the .deb / .rpm.</p>
          <p>The app asks for your 9Drive address once, then signs you in through this website. It updates itself.</p>
        </section>
        {platform ? null : <p className="text-[12px] text-subtle">Available for {Object.values(platformNames).join(', ')}.</p>}
      </main>
    </div>
  )
}
