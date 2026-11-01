import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBack } from '../lib/backStack'

const BUTTON = {
  primary: 'bg-accent text-accent-ink hover:bg-accent/90',
  secondary: 'bg-surface text-ink shadow-card hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'text-danger hover:bg-danger/10',
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...props }) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm'
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${sizing} ${BUTTON[variant]} ${className}`}
      {...props}
    />
  )
}

export function IconButton({ label, className = '', children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * A panel over the app: a bottom sheet on phones, and on wider screens either a drawer on the right
 * (`side`) or a centered dialog.
 */
export function Sheet({ title, onClose, children, footer, side = false, wide = false }) {
  useBack(onClose)
  const { panel, drag } = useSwipeDown(onClose)

  const desktop = side
    ? 'md:inset-y-0 md:right-0 md:left-auto md:top-0 md:w-[440px] md:max-h-none md:h-full md:rounded-none md:border-l md:border-line md:slide-in-right'
    : `md:inset-0 md:m-auto md:rounded-2xl md:h-[min(760px,88dvh)] md:max-h-none md:fade-in ${wide ? 'md:w-[720px]' : 'md:w-[520px]'}`

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 fade-in" onClick={onClose} />
      <div
        ref={panel}
        className={`absolute inset-x-0 bottom-0 max-h-[92dvh] flex flex-col bg-surface rounded-t-2xl shadow-pop slide-up ${desktop}`}
      >
        {/* Phones: drag the top bar down to close, like any bottom sheet. */}
        <div {...drag} className="relative flex items-center justify-between gap-3 px-5 h-14 border-b border-line flex-shrink-0 touch-none md:touch-auto">
          <span className="md:hidden absolute top-1.5 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-line" aria-hidden />
          <h2 className="text-[15px] font-semibold text-ink truncate">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X size={18} />
          </IconButton>
        </div>
        <div className={`flex-1 overflow-y-auto overscroll-contain ${footer ? '' : 'pb-safe'}`}>{children}</div>
        {footer && <div className="flex-shrink-0 border-t border-line px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/**
 * A bottom sheet that closes when its top bar is dragged down: `panel` goes on the sheet and `drag` on its top bar.
 * The sheet follows the finger, and letting go far enough down (or with a quick flick) calls `onClose`.
 * Phones only; buttons in the bar still work.
 */
function useSwipeDown(onClose) {
  const panel = useRef(null)
  const start = useRef(null)
  const move = (dy) => {
    if (panel.current) panel.current.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }
  const drag = {
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button') || window.matchMedia('(min-width: 768px)').matches) return
      start.current = { y: e.clientY, t: Date.now() }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e) => { if (start.current) move(e.clientY - start.current.y) },
    onPointerUp: (e) => {
      if (!start.current) return
      const dy = e.clientY - start.current.y
      const fast = dy > 40 && dy / Math.max(1, Date.now() - start.current.t) > 0.6
      start.current = null
      if (dy > 120 || fast) onClose()
      else if (panel.current) {
        panel.current.style.transition = 'transform 0.18s ease-out'
        move(0)
        setTimeout(() => { if (panel.current) panel.current.style.transition = '' }, 200)
      }
    },
    onPointerCancel: () => { start.current = null; move(0) },
  }
  return { panel, drag }
}

export function Segmented({ value, options, onChange, size = 'md' }) {
  return (
    <div className="flex p-0.5 rounded-lg bg-surface-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${
            size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px]'
          } ${value === o.value ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}

/** A callout inside a form: tone is 'info' | 'warn' | 'danger' | 'success'. */
export function Note({ tone = 'info', children, className = '' }) {
  const tones = {
    info: 'bg-surface-2 text-ink-2',
    warn: 'bg-warn/10 text-warn',
    danger: 'bg-danger/10 text-danger',
    success: 'bg-success/10 text-success',
  }
  return <p className={`text-[13px] leading-relaxed rounded-lg px-3 py-2.5 ${tones[tone]} ${className}`}>{children}</p>
}

export const fieldClass =
  'h-9 rounded-lg bg-surface-2 px-3 text-sm text-ink outline-none border border-transparent focus:border-accent/50 focus:bg-surface transition-colors'
