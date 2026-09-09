import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
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
  title?: string
}

/** Clean, minimal native macOS / Windows / Linux draggable titlebar.
 *  Uses explicit LTR direction so macOS traffic lights on the physical left
 *  are never clipped by RTL document direction flips. */
export function DesktopTitleBar({ title }: DesktopTitleBarProps) {
  const m = useMessages()
  const [isMaximized, setIsMaximized] = useState(false)

  const isMac = useMemo(isMacOS, [])

  useEffect(() => {
    if (isDesktop()) {
      try {
        const win = getCurrentWindow()
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
  }, [])

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

  return (
    <div
      dir="ltr"
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className="custom-titlebar sticky top-0 z-40 flex h-8.5 w-full shrink-0 select-none items-center justify-between border-b border-ink-800/30 bg-[#0c0e0b]/90 px-3 text-xs text-ink-300 backdrop-blur-xl"
    >
      {/* Physical Left Section */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 shrink-0"
        style={{ paddingLeft: isMac ? '76px' : '6px' }}
      >
        <span
          data-tauri-drag-region
          className="font-display text-[11px] font-semibold tracking-wider text-ink-400 opacity-60 select-none"
        >
          {title || m.app.name}
        </span>
      </div>

      {/* Draggable Empty Space */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Physical Right Section */}
      <div className="flex items-center gap-2 shrink-0" data-no-drag>
        {/* Non-Mac Window Buttons */}
        {!isMac && (
          <div className="ms-1 flex items-center gap-0.5" data-no-drag>
            <button
              type="button"
              onClick={() => handleWindowAction('minimize')}
              className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              title={m.desktopNav.window.minimize}
              aria-label={m.desktopNav.window.minimize}
            >
              <svg
                className="size-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M2 6h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleWindowAction('maximize')}
              className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              title={isMaximized ? m.desktopNav.window.restore : m.desktopNav.window.maximize}
              aria-label={isMaximized ? m.desktopNav.window.restore : m.desktopNav.window.maximize}
            >
              <svg
                className="size-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                {isMaximized ? <path d="M3.5 4.5h4v4h-4zM4.5 3.5h4v4" /> : <path d="M3 3h6v6H3z" />}
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleWindowAction('close')}
              className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-danger/80 hover:text-white"
              title={m.desktopNav.window.close}
              aria-label={m.desktopNav.window.close}
            >
              <svg
                className="size-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path d="M3 3l6 6M9 3L3 9" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
