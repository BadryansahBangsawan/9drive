import { useEffect, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu'
import { Segmented } from '@/components/ui/segmented'
import { getGravatarUrl } from '@/lib/gravatar'
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme'
import type { AuthUser } from '@/lib/auth'

const MENU_WIDTH = 224

export function AvatarMenu({ user, onLogout }: { user: AuthUser | null; onLogout: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [imageError, setImageError] = useState(false)
  const [pref, setPref] = useState<ThemePreference>(getThemePreference)

  useEffect(() => {
    setImageError(false)
    getGravatarUrl(user?.email, 64).then(setImageUrl).catch(() => setImageUrl(''))
  }, [user?.email])

  function toggle() {
    if (pos) return setPos(null)
    setPref(getThemePreference())
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPos({ x: rect.right - MENU_WIDTH, y: rect.bottom + 6 })
  }

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase()

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={toggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-selected text-xs font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {imageUrl && !imageError ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" onError={() => setImageError(true)} />
        ) : (
          initial
        )}
      </button>
      <Menu open={pos !== null} x={pos?.x ?? 0} y={pos?.y ?? 0} onClose={() => setPos(null)}>
        <div className="w-52 px-2 py-1.5">
          <p className="truncate text-[13px] font-medium text-text">{user?.name ?? 'User'}</p>
          <p className="truncate text-xs text-muted">{user?.email ?? ''}</p>
        </div>
        <MenuSeparator />
        <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
          <p className="mb-1.5 text-[11px] font-medium text-subtle">Theme</p>
          <Segmented<ThemePreference>
            value={pref}
            onChange={(next) => { setPref(next); setThemePreference(next) }}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </div>
        <MenuSeparator />
        <MenuItem icon={<LogOut className="h-4 w-4" strokeWidth={1.5} />} onSelect={() => { setPos(null); onLogout() }}>Sign out</MenuItem>
      </Menu>
    </>
  )
}
