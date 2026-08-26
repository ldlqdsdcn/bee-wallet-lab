import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

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
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...rest} />
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

export function Alert({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
      {children}
    </p>
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
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-400">{label}</span>
      <textarea
        className={`min-h-24 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none placeholder:text-ink-600 focus:border-honey-500 ${className}`}
        {...rest}
      />
      {hint ? <span className="mt-1 block text-xs text-ink-600">{hint}</span> : null}
    </label>
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
