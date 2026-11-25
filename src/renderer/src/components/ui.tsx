import type { ButtonHTMLAttributes, ReactNode } from 'react'

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

export function PageHeader({ icon, title, subtitle, action }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
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

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
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
