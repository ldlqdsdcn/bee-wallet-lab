import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const variants = {
  primary: 'bg-honey-500 text-ink-950 hover:bg-honey-400',
  ghost: 'border border-ink-600 text-ink-200 hover:border-honey-500 hover:text-honey-400',
  danger: 'bg-red-600 text-white hover:bg-red-500',
} as const

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; loading?: boolean }) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-400">{label}</span>
      <input
        className={`w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none placeholder:text-ink-600 focus:border-honey-500 ${className}`}
        {...rest}
      />
      {hint ? <span className="mt-1 block text-xs text-ink-600">{hint}</span> : null}
    </label>
  )
}

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-ink-700 bg-ink-800/60 p-5 ${className}`}>
      {title || action ? (
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-200">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  )
}

const alertTones = {
  error: 'border-red-500/40 bg-red-500/10 text-red-300',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  pending: 'border-honey-500/40 bg-honey-500/10 text-honey-200',
} as const

export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode
  tone?: keyof typeof alertTones
}) {
  if (!children) return null
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${alertTones[tone]}`}>
      {children}
    </div>
  )
}

const selectClass =
  'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none focus:border-honey-500'

export function Select({
  label,
  hint,
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-400">{label}</span>
      <select className={`${selectClass} ${className}`} {...rest}>
        {children}
      </select>
      {hint ? <span className="mt-1 block text-xs text-ink-600">{hint}</span> : null}
    </label>
  )
}

export function TextArea({
  label,
  hint,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-xs font-medium text-ink-400">{label}</span> : null}
      <textarea
        className={`min-h-24 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none placeholder:text-ink-600 focus:border-honey-500 ${className}`}
        {...rest}
      />
      {hint ? <span className="mt-1 block text-xs text-ink-600">{hint}</span> : null}
    </label>
  )
}

export function Modal({
  title,
  children,
  onClose,
  wide,
  className = '',
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`w-full rounded-xl border border-ink-600 bg-ink-900 p-5 shadow-2xl ${wide ? 'max-w-xl' : 'max-w-md'} ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="modal-title" className="text-sm font-semibold text-ink-200">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

/** 后续任务未落地的页面占位。 */
export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-lg font-semibold text-ink-200">{title}</h2>
      <p className="max-w-md text-sm text-ink-400">{note}</p>
    </div>
  )
}
