import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const MARGIN = 8

export function Menu({
  open,
  x,
  y,
  onClose,
  children,
}: {
  open: boolean
  x: number
  y: number
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState({ left: x, top: y })
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  // Clamp to the viewport after measuring, before paint.
  React.useLayoutEffect(() => {
    if (!open || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN))
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN))
    setPos({ left, top })
  }, [open, x, y])

  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()

    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      } else if (e.key === 'Tab') {
        onCloseRef.current()
      }
    }
    const close = () => onCloseRef.current()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('contextmenu', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('contextmenu', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  function onMenuKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    let n = 0
    if (e.key === 'ArrowDown') n = (i + 1) % items.length
    else if (e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length
    else if (e.key === 'End') n = items.length - 1
    items[n].focus()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onMenuKey}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 min-w-[200px] rounded-[10px] border border-border bg-bg p-1 text-text"
    >
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({
  icon,
  children,
  shortcut,
  danger,
  onSelect,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  shortcut?: string
  danger?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-hover focus:bg-hover focus:outline-none',
        danger ? 'text-danger' : 'text-text',
      )}
    >
      {icon && (
        <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center', danger ? 'text-danger' : 'text-muted')} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 text-[11px] text-subtle">{shortcut}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />
}
