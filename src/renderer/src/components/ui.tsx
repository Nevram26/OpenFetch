import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, Copy } from 'lucide-react'
import type { ErrorCode } from '../../../shared/errors'

const base =
  'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const variants = {
  primary: 'bg-leaf-600 text-white hover:bg-leaf-700',
  secondary: 'border border-line bg-white text-ink hover:bg-leaf-50',
  soft: 'bg-leaf-100 text-leaf-700 hover:bg-leaf-200'
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function PageHeader({
  icon,
  title,
  subtitle,
  action
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="mt-1 text-forest" aria-hidden>
          {icon}
        </span>
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  )
}

export function EmptyState({
  icon,
  title,
  children
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-leaf-300 bg-side px-6 py-14 text-center">
      <span className="mb-3 text-leaf-600" aria-hidden>
        {icon}
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-1 max-w-md text-sm text-muted">{children}</div>
    </div>
  )
}

const errorText: Partial<Record<ErrorCode, [title: string, hint: string]>> = {
  network: ['You appear to be offline', 'Check your internet connection, then try again.'],
  rate_limited: ['YouTube is limiting requests', 'Wait a few minutes, then try again.'],
  bot_check: [
    'YouTube is asking for a bot check',
    'Wait a while and try again. OpenFetch never uses logins or cookies to get around this.'
  ],
  unavailable: ['This video is unavailable', 'It may have been removed.'],
  private: ['This video is private', 'Only its owner can access it.'],
  geo_restricted: ['Not available in your region', 'The uploader blocked it in your country.'],
  engine_missing: ['The download engine is missing', 'Reinstall OpenFetch to restore it.'],
  invalid_input: ['That input is not supported', 'Check it and try again.']
}

/** Failure panel with retry and "Copy diagnostics" (error code + engine stderr tail; never the query). */
export function EngineError({
  code,
  stderrTail,
  onRetry
}: {
  code: ErrorCode
  stderrTail: string
  onRetry?: () => void
}) {
  const [title, hint] = errorText[code] ?? ['Something went wrong', 'Try again in a moment.']
  const [copied, setCopied] = useState(false)
  const copy = () =>
    window.openfetch
      .copyText(
        `OpenFetch diagnostics
error: ${code}
${stderrTail}`.trim()
      )
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-lg border border-danger/40 bg-danger/5 px-6 py-10 text-center"
    >
      <AlertTriangle size={32} className="mb-3 text-danger" aria-hidden />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{hint}</p>
      <div className="mt-4 flex gap-3">
        {onRetry && (
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button onClick={() => void copy()}>
          <Copy size={16} aria-hidden /> {copied ? 'Copied' : 'Copy diagnostics'}
        </Button>
      </div>
    </div>
  )
}
