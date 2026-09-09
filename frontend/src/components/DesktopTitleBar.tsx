import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Search } from 'lucide-react'
import clsx from 'clsx'
import {
  isDesktop,
  isMacOS,
  startDragging,
  toggleMaximize,
  minimizeWindow,
  closeWindow,
} from '../lib/desktop'
import { useMessages } from '../lib/i18n'

interface DesktopTitleBarProps {
  onOpenPalette?: () => void
}

/** Clean, minimal native macOS / Windows / Linux draggable titlebar.
 *  Uses explicit LTR direction so macOS traffic lights on the physical left
 *  are never clipped by RTL document direction flips. */
export function DesktopTitleBar({ onOpenPalette }: DesktopTitleBarProps) {
  const m = useMessages()
  const [isMaximized, setIsMaximized] = useState(false)

  const isMac = useMemo(isMacOS, [])

  useEffect(() => {
    if (isDesktop()) {
      try {
        const win = getCurrentWindow()
        if (!isMac) {
          win.setDecorations(false).catch(() => {})
          win.setShadow(true).catch(() => {})
        }
        win
          .isMaximized()
          .then(setIsMaximized)
          .catch(() => {})
        const unlisten = win.onResized(() => {
          win
            .isMaximized()
            .then(setIsMaximized)
            .catch(() => {})
        })
        return () => {
          unlisten.then((fn) => fn()).catch(() => {})
        }
      } catch {
        // ignore
      }
    }
  }, [isMac])

  if (!isDesktop()) return null

  const handleMouseDown = async (e: React.MouseEvent) => {
    if (e.buttons !== 1) return
    if ((e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) {
      return
    }
    if (e.detail === 2) {
      await toggleMaximize()
      setIsMaximized((prev) => !prev)
    } else {
      await startDragging()
    }
  }

  const handleWindowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    if (action === 'minimize') {
      await minimizeWindow()
    } else if (action === 'maximize') {
      await toggleMaximize()
      setIsMaximized((prev) => !prev)
    } else {
      await closeWindow()
    }
  }

  const sideWidth = isMac ? '78px' : '132px'

  return (
    <div
      dir="ltr"
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className={clsx(
        'custom-titlebar sticky top-0 z-40 flex h-10 w-full shrink-0 select-none items-center justify-between border-b border-white/[0.06] bg-ink-950/90 text-xs text-ink-300 backdrop-blur-xl',
        isMac ? 'px-3' : 'ps-3 pe-0',
      )}
    >
      {/* Physical Left Spacer: Offset for macOS traffic lights, or balancing right controls on Windows/Linux */}
      <div
        data-tauri-drag-region
        className="shrink-0 h-full flex items-center"
        style={{ width: sideWidth }}
      />

      {/* Center Search / Command trigger pill */}
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center justify-center px-4 h-full cursor-default"
      >
        {onOpenPalette && (
          <button
            type="button"
            data-no-drag
            onClick={onOpenPalette}
            className="group flex h-6.5 w-full max-w-sm items-center justify-between gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 text-[11px] text-ink-400 shadow-sm transition hover:border-lime-flash/40 hover:bg-white/[0.06] hover:text-ink-200 active:scale-[0.99]"
            title={m.desktopNav.commandPaletteHint}
          >
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <Search className="size-3 text-ink-500 transition group-hover:text-lime-flash shrink-0" />
              <span className="truncate" dir="auto">
                {m.desktopNav.commandPaletteHint}
              </span>
            </span>
            <kbd className="shrink-0 rounded border border-white/[0.08] bg-black/30 px-1 py-0.2 font-mono text-[9px] font-semibold text-ink-400">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </button>
        )}
      </div>

      {/* Physical Right Section / Spacer (matching width on both sides to keep center search perfectly centered) */}
      <div
        className="flex items-center justify-end shrink-0 h-full"
        style={{ width: sideWidth }}
        data-tauri-drag-region
      >
        {/* Non-Mac Native Window Controls */}
        {!isMac && (
          <div className="flex items-center h-full" data-no-drag>
            <button
              type="button"
              onClick={() => handleWindowAction('minimize')}
              className="grid h-10 w-11 place-items-center text-ink-400 hover:bg-white/[0.08] hover:text-ink-100 transition-colors"
              title={m.desktopNav.window.minimize}
            >
              <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
                <rect width="10" height="1" rx="0.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleWindowAction('maximize')}
              className="grid h-10 w-11 place-items-center text-ink-400 hover:bg-white/[0.08] hover:text-ink-100 transition-colors"
              title={isMaximized ? m.desktopNav.window.restore : m.desktopNav.window.maximize}
            >
              {isMaximized ? (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                >
                  <rect x="2.5" y="0.5" width="7" height="7" rx="0.5" />
                  <path d="M0.5 3.5V9.5H6.5" />
                </svg>
              ) : (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 9 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                >
                  <rect x="0.6" y="0.6" width="7.8" height="7.8" rx="0.5" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleWindowAction('close')}
              className="grid h-10 w-11 place-items-center text-ink-400 hover:bg-[#e81123] hover:text-white transition-colors"
              title={m.desktopNav.window.close}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              >
                <path d="M1 1L9 9M9 1L1 9" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
