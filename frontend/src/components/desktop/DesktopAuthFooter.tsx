import { Link } from 'react-router-dom'
import { getServerUrl, isDesktop } from '@/lib/runtime'

// Desktop only: which server the app signs in to, and the "finish in your browser" note for Google.
export function DesktopAuthFooter({ notice }: { notice?: string }) {
  if (!isDesktop) return null
  const server = getServerUrl()
  return (
    <>
      {notice ? <p role="status" className="mt-4 text-center text-[13px] text-muted">{notice}</p> : null}
      <p className="mt-3 text-center text-[12px] text-subtle">
        Server: {server ? new URL(server).host : 'not set'} · <Link className="font-medium text-accent hover:underline" to="/server">Change</Link>
      </p>
    </>
  )
}
