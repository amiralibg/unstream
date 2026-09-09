import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

export interface DropdownOption {
  value: string
  label: string
  /** Optional second line — what the option means, when the label alone
   *  isn't enough. */
  hint?: string
}

/** A listbox that looks like the rest of the app.
 *
 *  A native `<select>` renders as an OS menu: light chrome on a dark panel,
 *  the system font instead of ours, and on macOS a popup that ignores every
 *  border and radius around it. Only its options can be styled, and only
 *  barely. This is the same control drawn in the app's own language.
 *
 *  Keyboard behaviour follows the ARIA listbox pattern, with focus staying
 *  on the trigger and the active option tracked by `aria-activedescendant`
 *  — fewer moving parts than roving focus, and a screen reader announces
 *  the same thing.
 */
export function Dropdown({
  value,
  options,
  onChange,
  label,
  placeholder,
  className,
  align = 'end',
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  /** Accessible name — this control never has a visible one. */
  label: string
  placeholder?: string
  className?: string
  /** Which edge the panel lines up with. Logical, so RTL mirrors it. */
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // This control sits low in a scrolling settings panel, so a list long
  // enough to run past the window opens upward instead of off-screen.
  const [dropUp, setDropUp] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const id = useId()

  const selected = options.findIndex((option) => option.value === value)
  const current = selected >= 0 ? options[selected] : null

  // Opening lands on the current choice, not the top of the list.
  useEffect(() => {
    if (open) setActive(selected >= 0 ? selected : 0)
  }, [open, selected])

  useEffect(() => {
    if (!open) return
    const box = buttonRef.current?.getBoundingClientRect()
    if (!box) return
    // 40px a row, capped at the panel's own max height.
    const wanted = Math.min(options.length * 40 + 12, 256)
    const below = window.innerHeight - box.bottom
    setDropUp(below < wanted + 12 && box.top > below)
  }, [open, options.length])

  // Pointer down rather than click: a click that starts inside and ends
  // outside shouldn't close it, and the reverse shouldn't swallow the
  // press on whatever was clicked.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the active option in view when arrowing past the panel's edge.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
        break
      case 'ArrowDown':
        e.preventDefault()
        setActive((at) => Math.min(options.length - 1, at + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((at) => Math.max(0, at - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Tab':
        // Tab commits nothing and moves on, like a native listbox.
        setOpen(false)
        break
    }
  }

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        aria-label={label}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onKeyDown}
        className={clsx(
          'flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 text-[11px] font-semibold outline-none transition',
          'focus-visible:ring-2 focus-visible:ring-lime-flash/40',
          open
            ? 'border-lime-flash/40 bg-white/[0.07] text-ink-100'
            : 'border-white/[0.07] bg-white/[0.035] text-ink-200 hover:bg-white/[0.07]',
        )}
      >
        <span className="truncate">{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown
          className={clsx(
            'size-3.5 shrink-0 text-ink-500 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={clsx(
            // Above the panel's own stacking, and tall enough to scroll
            // rather than run off the window on a short list of many.
            'absolute z-50 max-h-64 min-w-full overflow-y-auto rounded-xl border border-white/[0.09] bg-[#14180f] p-1 shadow-[0_18px_40px_rgba(0,0,0,0.5)] animate-fade-up',
            align === 'end' ? 'end-0' : 'start-0',
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {options.map((option, i) => {
            const isSelected = option.value === value
            return (
              <li key={option.value}>
                <button
                  type="button"
                  id={`${id}-option-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={i === active || undefined}
                  // Hover moves the active option, so pointer and keyboard
                  // never disagree about what Enter would pick.
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[11px] transition',
                    i === active ? 'bg-white/[0.07]' : 'bg-transparent',
                    isSelected ? 'font-semibold text-lime-flash' : 'font-medium text-ink-200',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.hint && (
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-ink-500">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {isSelected && <Check className="size-3.5 shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
