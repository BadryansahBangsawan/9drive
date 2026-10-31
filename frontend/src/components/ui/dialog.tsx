import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE =
  'input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}) {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose
  const titleId = React.useId()

  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const first = bodyRef.current?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])')
    ;(first ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current)?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || !panelRef.current.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && (active === lastEl || !panelRef.current.contains(active))) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width }}
        className="flex max-h-[calc(100vh-2rem)] max-w-full flex-col rounded-[14px] border border-border bg-bg text-text shadow-[0_16px_48px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.08)] outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {children}
        </div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 pb-4 pt-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
