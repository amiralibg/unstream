import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  CornerDownLeft,
  FolderOpen,
  Link2,
  ListMusic,
  Search,
  Settings,
} from 'lucide-react'
import clsx from 'clsx'
import { isCatalogUrl } from '../lib/api'
import { getDownloadsDir, openFolder } from '../lib/desktop'
import { faNumerals, useMessages } from '../lib/i18n'
import type { RecentSearch } from '../lib/recent'
import type { DesktopTab } from './DesktopSidebar'

interface DesktopCommandPaletteProps {
  onClose: () => void
  onSelectTab: (tab: DesktopTab) => void
  onSubmit: (input: string) => void
  recent: RecentSearch[]
}

interface Action {
  id: string
  label: string
  icon: typeof Search
  run: () => void
}

/** Cmd+K palette for the desktop shell: navigation, folder reveal, recent
 *  searches — and whatever is typed doubles as a search box or a pasted
 *  link, so the fastest path through the app is one shortcut. */
export function DesktopCommandPalette({
  onClose,
  onSelectTab,
  onSubmit,
  recent,
}: DesktopCommandPaletteProps) {
  const m = useMessages()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const trimmed = query.trim()
  const isLink = trimmed.length > 0 && isCatalogUrl(trimmed)

  const actions: Action[] = useMemo(() => {
    const q = trimmed.toLowerCase()
    const matches = (label: string) => q.length === 0 || label.toLowerCase().includes(q)
    const list: Action[] = []

    if (trimmed.length > 0) {
      list.push({
        id: 'submit',
        label: isLink ? m.palette.openLink : m.palette.searchFor(trimmed),
        icon: isLink ? Link2 : Search,
        run: () => onSubmit(trimmed),
      })
    }

    const nav: { id: string; label: string; icon: typeof Search; tab: DesktopTab }[] = [
      { id: 'nav-search', label: m.desktopNav.search, icon: Search, tab: 'search' },
      {
        id: 'nav-downloads',
        label: m.desktopNav.downloads,
        icon: ArrowDownToLine,
        tab: 'downloads',
      },
      { id: 'nav-settings', label: m.desktopNav.settings, icon: Settings, tab: 'settings' },
      { id: 'nav-library', label: m.desktopNav.library, icon: ListMusic, tab: 'library' },
    ]
    for (const item of nav) {
      if (matches(item.label)) {
        list.push({
          id: item.id,
          label: item.label,
          icon: item.icon,
          run: () => onSelectTab(item.tab),
        })
      }
    }

    if (matches(m.settings.downloadsFolder) || matches('folder') || matches('پوشه')) {
      list.push({
        id: 'reveal-folder',
        label: m.settings.openInFinder,
        icon: FolderOpen,
        run: () => {
          void getDownloadsDir().then((dir) => {
            if (dir) void openFolder(dir)
          })
        },
      })
    }

    if (q.length === 0) {
      for (const item of recent.slice(0, 5)) {
        list.push({
          id: `recent:${item.input}`,
          label: item.input,
          icon: item.isLink ? Link2 : Search,
          run: () => onSubmit(item.input),
        })
      }
    }

    return list
  }, [trimmed, isLink, m, onSubmit, onSelectTab, recent])

  useEffect(() => {
    setActive(0)
  }, [actions.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => Math.min(actions.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const action = actions[active]
        if (action) {
          onClose()
          action.run()
        } else if (trimmed.length > 0) {
          onClose()
          onSubmit(trimmed)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, active, onClose, onSubmit, trimmed])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[14vh] backdrop-blur-[3px] animate-fade-up"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m.desktopNav.search}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#121510]/95 shadow-[0_30px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4">
          <Search className="size-4 shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.palette.placeholder}
            dir="auto"
            className="h-12 w-full bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-600"
          />
          <kbd className="shrink-0 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-sans text-[10px] text-ink-500">
            esc
          </kbd>
        </div>

        {trimmed.length === 0 && recent.length > 0 && (
          <p className="px-4 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-600">
            {m.palette.recent}
          </p>
        )}

        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1.5">
          {actions.map((action, i) => {
            const Icon = action.icon
            const isActive = i === active
            return (
              <li key={action.id}>
                <button
                  type="button"
                  data-active={isActive || undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onClose()
                    action.run()
                  }}
                  className={clsx(
                    'flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-start text-[13px] transition duration-100',
                    isActive ? 'bg-lime-flash/[0.1] text-ink-100' : 'text-ink-300',
                  )}
                >
                  <Icon
                    className={clsx(
                      'size-4 shrink-0',
                      isActive ? 'text-lime-flash' : 'text-ink-500',
                    )}
                  />
                  <span
                    className={clsx('min-w-0 flex-1 truncate', faNumerals(action.label))}
                    dir="auto"
                  >
                    {action.label}
                  </span>
                  {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-ink-500" />}
                </button>
              </li>
            )
          })}
          {actions.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-ink-500">{m.palette.empty}</li>
          )}
        </ul>
      </div>
    </div>
  )
}
