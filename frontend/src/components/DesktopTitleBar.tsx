import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { FolderOpen, Settings2 } from 'lucide-react'
import {
  isDesktop,
  getDownloadsDir,
  pickDownloadsDir,
  openFolder,
  startDragging,
  toggleMaximize,
  minimizeWindow,
  closeWindow,
} from '../lib/desktop'
import { useMessages } from '../lib/i18n'

interface DesktopTitleBarProps {
  onOpenSettings: () => void
}

/** Modern macOS / Windows / Linux draggable titlebar.
 *  Uses explicit LTR direction so macOS traffic lights on the physical left
 *  are never clipped by RTL document direction flips. */
export function DesktopTitleBar({ onOpenSettings }: DesktopTitleBarProps) {
  const m = useMessages()
  const [downloadsDir, setDownloadsDir] = useState<string>('')
  const [isMaximized, setIsMaximized] = useState(false)

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true
    return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform)
  }, [])

  useEffect(() => {
    if (isDesktop()) {
      getDownloadsDir().then(setDownloadsDir)
      try {
        const win = getCurrentWindow()
        win.isMaximized().then(setIsMaximized).catch(() => {})
        const unlisten = win.onResized(() => {
          win.isMaximized().then(setIsMaximized).catch(() => {})
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

  const handlePickFolder = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const picked = await pickDownloadsDir()
    if (picked) {
      setDownloadsDir(picked)
    }
  }

  const handleOpenFolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (downloadsDir) {
      openFolder(downloadsDir)
    }
  }

  // Shorten path for display (e.g. /Users/name/Music/Unstream -> ~/Music/Unstream)
  const displayPath = downloadsDir
    ? downloadsDir.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/, '~')
    : '~/Music/Unstream'

  return (
    <div
      dir="ltr"
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className="custom-titlebar sticky top-0 z-40 flex h-9 w-full shrink-0 select-none items-center justify-between border-b border-ink-800/40 bg-ink-950/80 px-3 text-xs text-ink-300 backdrop-blur-xl"
    >
      {/* Physical Left Section */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 shrink-0"
        style={{ paddingLeft: isMac ? '76px' : '6px' }}
      >
        <span
          data-tauri-drag-region
          className="font-display text-[11px] font-semibold tracking-wider text-ink-400 opacity-75 select-none"
        >
          {m.app.name}
        </span>
      </div>

      {/* Draggable Empty Space */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Physical Right Section */}
      <div className="flex items-center gap-2 shrink-0" data-no-drag>
        {/* Downloads Folder Pill */}
        <div className="flex items-center rounded-full border border-ink-800/80 bg-ink-900/60 p-0.5 shadow-sm transition hover:border-ink-700">
          <button
            type="button"
            onClick={handleOpenFolder}
            title={m.settings.openInFinder}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-micro font-medium text-ink-300 transition hover:bg-ink-800 hover:text-lime-flash"
          >
            <FolderOpen className="size-3 text-lime-flash" />
            <span className="max-w-[150px] truncate font-mono text-[11px]">
              {displayPath}
            </span>
          </button>
          <button
            type="button"
            onClick={handlePickFolder}
            title={m.settings.changeFolder}
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
          >
            {m.settings.changeFolder}
          </button>
        </div>

        {/* Settings Button */}
        <button
          type="button"
          onClick={onOpenSettings}
          title={m.settings.label}
          aria-label={m.settings.label}
          className="tap-target grid size-7 place-items-center rounded-ctl text-ink-400 transition hover:bg-ink-800 hover:text-ink-100 active:scale-95"
        >
          <Settings2 className="size-3.5" />
        </button>

        {/* Non-Mac Window Buttons */}
        {!isMac && (
          <div className="ms-1 flex items-center gap-0.5" data-no-drag>
            <button
              type="button"
              onClick={() => handleWindowAction('minimize')}
              className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              title="Minimize"
              aria-label="Minimize"
            >
              <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M2 6h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleWindowAction('maximize')}
              className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-ink-800 hover:text-ink-100"
              title={isMaximized ? 'Restore' : 'Maximize'}
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
            >
              <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                {isMaximized ? (
                  <path d="M3.5 4.5h4v4h-4zM4.5 3.5h4v4" />
                ) : (
                  <path d="M3 3h6v6H3z" />
                )}
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleWindowAction('close')}
              className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-danger/80 hover:text-white"
              title="Close"
              aria-label="Close"
            >
              <svg className="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M3 3l6 6M9 3L3 9" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
