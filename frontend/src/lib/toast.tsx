import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import clsx from 'clsx'
import { useMessages } from './i18n'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  kind: ToastKind
  action?: ToastAction
  leaving?: boolean
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind, action?: ToastAction) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const KIND_ICON = {
  success: <CircleCheck className="size-4 shrink-0 text-lime-flash" />,
  error: <CircleAlert className="size-4 shrink-0 text-danger" />,
  info: <Info className="size-4 shrink-0 text-ink-300" />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const m = useMessages()

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 200)
  }, [])

  const push = useCallback(
    (message: string, kind: ToastKind = 'info', action?: ToastAction) => {
      const id = nextId.current++
      setToasts((prev) => [...prev.slice(-2), { id, message, kind, action }])
      // Actionable toasts (like "new version") wait for the user.
      if (!action) setTimeout(() => dismiss(id), 4500)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* Full-bleed on phones (a 20rem card floating in a 24rem viewport reads
          as a misplaced desktop element), a corner card from sm up. The dock
          FAB shares the bottom edge on mobile, so the stack lifts above it
          via --dock-lift, which DownloadsDock sets while it has jobs; from sm
          up the dock sits in the opposite corner and the lift is dropped. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+var(--safe-bottom)+var(--dock-lift,0px))] z-60 flex flex-col gap-2 sm:inset-x-auto sm:start-5 sm:bottom-[calc(1.25rem+var(--safe-bottom))] sm:w-80"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              'pointer-events-auto flex items-center gap-2.5 rounded-btn border bg-ink-900/95 px-4 py-3 text-mini text-ink-100 shadow-xl shadow-shade/40 backdrop-blur transition-all duration-200',
              // A hairline in the accent tells you the outcome before you read it.
              toast.kind === 'success'
                ? 'border-lime-flash/40'
                : toast.kind === 'error'
                  ? 'border-danger/40'
                  : 'border-ink-700',
              toast.leaving ? 'translate-y-1 scale-[0.97] opacity-0' : 'animate-toast-in',
            )}
          >
            {KIND_ICON[toast.kind]}
            <span className="min-w-0 flex-1" dir="auto">
              {toast.message}
            </span>
            {toast.action && (
              <button
                onClick={() => {
                  dismiss(toast.id)
                  toast.action!.onClick()
                }}
                className="tap-target shrink-0 rounded-ctl px-1.5 py-0.5 font-medium text-lime-flash transition hover:text-lime-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-flash"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              aria-label={m.notify.close}
              className="tap-target grid size-5 shrink-0 place-items-center rounded text-ink-400 transition hover:text-ink-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
