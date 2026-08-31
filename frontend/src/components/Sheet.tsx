import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

/** How far the sheet must be dragged down before letting go dismisses it.
 *  Same distance as the downloads dock, so the gesture feels like one app. */
const DISMISS_AFTER_PX = 90

interface Props {
  /** Names the dialog; a screen reader announces it on open. */
  label: string
  onClose: () => void
  children: ReactNode
  /** Panel width on the desktop layout. Replaces the default rather than
   *  adding to it, which is why it isn't a general `className`. */
  width?: string
}

/** A bottom sheet on phones, a centered modal on desktop — scrim,
 *  drag-to-dismiss, Escape, focus trap and scroll lock in one place.
 *
 *  The downloads dock deliberately does not use this: it is not modal, so it
 *  wants none of the trap, the lock or the scrim.
 */
export function Sheet({
  label,
  onClose,
  children,
  width = 'sm:w-[min(32rem,calc(100vw-2.5rem))]',
}: Props) {
  const [drag, setDrag] = useState(0)
  const startY = useRef<number | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)

  // Escape belongs to whichever sheet is up; App's global handler would
  // otherwise navigate back. Tab is caught for the same reason: `aria-modal`
  // tells a screen reader the page behind is gone, and a keyboard must agree.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey, true)
      // Back to whatever opened the sheet, so a keyboard lands where it left.
      opener?.focus?.()
    }
  }, [onClose])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    startY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startY.current == null) return
    setDrag(Math.max(0, e.clientY - startY.current)) // downward only
  }, [])
  const onPointerUp = useCallback(() => {
    if (startY.current == null) return
    startY.current = null
    if (drag > DISMISS_AFTER_PX) {
      onClose() // unmounts; no point springing back first
      return
    }
    setDrag(0)
  }, [drag, onClose])

  // Portaled because the view it mounts inside keeps `animate-fade-up`'s
  // transform, which would make these `fixed` elements resolve against that
  // div rather than the viewport — `inset-0` would then span the content.
  return createPortal(
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 animate-scrim-in bg-ink-950/70 backdrop-blur-[2px]"
      />
      {/* Positioning lives on the grid so the entrance animation can own
          `transform` without fighting a centering translate. */}
      <div className="pointer-events-none fixed inset-0 z-50 grid items-end justify-items-center p-4 sm:items-center sm:p-6">
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          style={{ transform: drag ? `translateY(${drag}px)` : undefined }}
          className={clsx(
            'pointer-events-auto flex max-h-[85svh] w-full flex-col overflow-hidden bg-ink-900 shadow-2xl shadow-black/60 outline-none',
            // mobile: bottom sheet, sliding up from its own edge.
            'rounded-t-panel border-t border-ink-700 pb-[var(--safe-bottom)]',
            // desktop: a centered modal that fades in instead.
            'sm:rounded-panel sm:border sm:border-ink-700 sm:pb-0',
            width,
            // Both the entrance and the drag drive `transform`, so only one runs.
            drag ? 'transition-none' : 'animate-sheet-in sm:animate-fade-up',
          )}
        >
          {/* The drag target, so it exists only on the layout anchored to an
              edge. Padded rather than tall: the grab area clears a thumb while
              the bar stays a hairline. */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative z-10 shrink-0 cursor-grab touch-none py-2.5 active:cursor-grabbing sm:hidden"
          >
            <div className="mx-auto h-1 w-9 rounded-full bg-ink-600" />
          </div>

          {children}
        </section>
      </div>
    </>,
    document.body,
  )
}
