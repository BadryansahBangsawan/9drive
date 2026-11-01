import type { ReactNode } from 'react'
import { LogoMark } from '@/components/brand/Logo'
import { isDesktop } from '@/lib/runtime'

export function AuthLogo() {
  return <LogoMark variant="full" className="h-12 w-auto" />
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className={`flex ${isDesktop ? 'min-h-full' : 'min-h-screen'} items-center justify-center bg-surface p-5`}>
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-bg p-7 shadow-[0_12px_32px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)]">{children}</div>
    </main>
  )
}

export function AuthDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-subtle">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />or<span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  )
}
