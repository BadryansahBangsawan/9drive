import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle } from 'lucide-react'
import { AuthShell } from '@/components/auth/AuthShell'

export function GoogleConnectedPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'success'
  const ok = status === 'success'

  useEffect(() => {
    window.opener?.postMessage({ type: 'GOOGLE_CONNECTED', status }, window.location.origin)
    const timer = window.setTimeout(() => {
      if (window.opener) window.close()
      else navigate('/settings')
    }, 800)
    return () => window.clearTimeout(timer)
  }, [navigate, status])

  return (
    <AuthShell>
      <div className="text-center">
        {ok ? <CheckCircle className="mx-auto h-8 w-8 text-drive" strokeWidth={1.5} /> : <XCircle className="mx-auto h-8 w-8 text-danger" strokeWidth={1.5} />}
        <h1 className="mt-4 text-lg font-semibold text-text">{ok ? 'Google Drive connected' : 'Connection failed'}</h1>
        <p className="mt-1 text-[13px] text-muted">{ok ? 'This window will close automatically.' : 'Close this window and try again.'}</p>
      </div>
    </AuthShell>
  )
}
