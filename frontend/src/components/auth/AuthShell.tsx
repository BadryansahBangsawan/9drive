import type { ReactNode } from 'react'
import { HardDrive } from 'lucide-react'

export function AuthLogo() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-fg" aria-hidden="true">
      <HardDrive className="h-4 w-4" strokeWidth={1.5} />
    </div>
  )
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-5">
      <div className="w-full max-w-[400px] rounded-xl border border-border bg-bg p-7">{children}</div>
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
