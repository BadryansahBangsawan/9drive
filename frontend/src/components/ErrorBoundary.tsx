import { Component, type ErrorInfo, type ReactNode } from 'react'

// Shows a render error instead of a blank window, with a way to reload.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('9Drive crashed while rendering', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="mx-auto grid max-w-xl gap-3 px-6 py-16 text-[13px] text-text">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted">9Drive hit an error while showing this page.</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-[12px] text-danger">{error.message}{'\n'}{error.stack}</pre>
        <div>
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 hover:bg-hover" onClick={() => window.location.assign('/all-files')}>Reload</button>
        </div>
      </div>
    )
  }
}
