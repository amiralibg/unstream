import { useEffect, useState } from 'react'
import { ArrowDownToLine, AudioLines, FolderOpen, ListMusic, Search, Settings } from 'lucide-react'
import clsx from 'clsx'
import { getDownloadsDir, openFolder, pickDownloadsDir } from '../lib/desktop'
import { useDownloads } from '../lib/downloads'
import { useMessages } from '../lib/i18n'

export type DesktopTab = 'search' | 'downloads' | 'library' | 'settings'

interface DesktopSidebarProps {
  activeTab: DesktopTab
  onSelectTab: (tab: DesktopTab) => void
}

export function DesktopSidebar({ activeTab, onSelectTab }: DesktopSidebarProps) {
  const m = useMessages()
  const { activeCount, entries } = useDownloads()
  const [downloadsDir, setDownloadsDir] = useState<string>('')

  useEffect(() => {
    getDownloadsDir().then(setDownloadsDir)
  }, [])

  const handleOpenFolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (downloadsDir) openFolder(downloadsDir)
  }

  const handlePickFolder = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const picked = await pickDownloadsDir()
    if (picked) setDownloadsDir(picked)
  }

  const displayPath = downloadsDir
    ? downloadsDir.replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/, '~')
    : '~/Music/Unstream'

  const navItems = [
    { id: 'search', label: m.desktopNav.search, icon: Search },
    { id: 'downloads', label: m.desktopNav.downloads, icon: ArrowDownToLine },
    { id: 'library', label: m.desktopNav.library, icon: ListMusic },
    { id: 'settings', label: m.desktopNav.settings, icon: Settings },
  ] as const

  return (
    <aside
      className="flex h-full w-[13.5rem] shrink-0 select-none flex-col border-e border-white/[0.055] bg-[#0c0e0b] text-ink-300"
      data-no-drag
    >
      <button
        type="button"
        onClick={() => onSelectTab('search')}
        className="group flex h-[4.5rem] shrink-0 items-center gap-3 border-b border-white/[0.05] px-4 text-start"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-lime-flash text-lime-ink shadow-[0_5px_18px_rgba(200,242,79,0.13)] transition duration-200 group-active:scale-95">
          <AudioLines className="size-[18px]" strokeWidth={2.4} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] font-bold tracking-[-0.015em] text-ink-100">
            {m.app.name}
          </span>
          <span className="mt-0.5 block text-[10px] font-medium tracking-wide text-ink-500">
            {m.desktopNav.musicDownloader}
          </span>
        </span>
      </button>

      <nav className="flex-1 space-y-1 px-2.5 py-3" aria-label={m.desktopNav.navigationLabel}>
        {navItems.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'group relative flex h-10 w-full items-center gap-3 rounded-[9px] px-3 text-xs font-semibold transition duration-150 active:scale-[0.985]',
                active
                  ? 'bg-white/[0.075] text-ink-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]'
                  : 'text-ink-400 hover:bg-white/[0.045] hover:text-ink-200',
              )}
            >
              {active && (
                <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-lime-flash" />
              )}
              <Icon
                className={clsx(
                  'size-[17px] shrink-0 transition-colors',
                  active ? 'text-lime-flash' : 'text-ink-500 group-hover:text-ink-300',
                )}
                strokeWidth={active ? 2.35 : 2}
              />
              <span className="min-w-0 flex-1 truncate text-start">{label}</span>
              {id === 'downloads' && activeCount > 0 ? (
                <span className="grid min-w-5 place-items-center rounded-full bg-lime-flash px-1.5 py-0.5 text-[10px] font-bold leading-none text-lime-ink">
                  {m.app.num(activeCount)}
                </span>
              ) : id === 'downloads' && entries.length > 0 ? (
                <span className="min-w-5 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-center text-[10px] font-medium leading-none text-ink-500">
                  {m.app.num(entries.length)}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-white/[0.05] p-3">
        <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-medium text-ink-500">
          <span>{m.settings.downloadsFolder}</span>
          <button
            type="button"
            onClick={handlePickFolder}
            className="rounded px-1 py-0.5 transition hover:bg-white/[0.05] hover:text-ink-200"
          >
            {m.settings.changeFolder}
          </button>
        </div>
        <button
          type="button"
          onClick={handleOpenFolder}
          title={m.settings.openInFinder}
          className="group flex h-9 w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 text-start transition hover:border-white/[0.1] hover:bg-white/[0.05] active:scale-[0.985]"
        >
          <FolderOpen className="size-3.5 shrink-0 text-ink-500 transition group-hover:text-lime-flash" />
          {/* A path is LTR text. Left to `auto` it starts with "~" or "/",
              which carries no direction, so the Farsi page reorders the
              segments and "~/Music/Unstream" renders as "Music/Unstream/~". */}
          <span
            dir="ltr"
            className="min-w-0 flex-1 truncate text-start font-mono text-[10px] text-ink-400 group-hover:text-ink-200"
          >
            {displayPath}
          </span>
        </button>
      </div>
    </aside>
  )
}
