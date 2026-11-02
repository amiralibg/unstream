import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  AudioLines,
  FolderOpen,
  Library,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Search,
  Settings,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getDesktopInfo,
  getDownloadsDir,
  isMacOS,
  openFolder,
  pickDownloadsDir,
  type DesktopInfo,
} from '../lib/desktop'
import { useDownloads } from '../lib/downloads'
import { useMessages } from '../lib/i18n'
import { usePlayer } from '../lib/player'
import { usePlaylists } from '../lib/playlists'
import { Artwork, PlayingBars, PlaylistCover } from './Artwork'

export type DesktopTab = 'search' | 'downloads' | 'library' | 'playlists' | 'settings'

interface DesktopSidebarProps {
  activeTab: DesktopTab
  onSelectTab: (tab: DesktopTab) => void
  onOpenKaraoke?: () => void
  /** The playlist open in the Playlists tab, highlighted in the list here. */
  activePlaylist?: string | null
  onOpenPlaylist?: (id: string) => void
}

export function DesktopSidebar({
  activeTab,
  onSelectTab,
  onOpenKaraoke,
  activePlaylist,
  onOpenPlaylist,
}: DesktopSidebarProps) {
  const m = useMessages()
  const { data: playlists } = usePlaylists()
  const { activeCount, entries } = useDownloads()
  const { current, playing, toggle } = usePlayer()
  const [downloadsDir, setDownloadsDir] = useState<string>('')
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const isMac = isMacOS()

  useEffect(() => {
    getDownloadsDir().then(setDownloadsDir)
    getDesktopInfo().then(setInfo)
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
    {
      id: 'search',
      label: m.desktopNav.search,
      icon: Search,
      shortcut: isMac ? '⌘1' : 'Alt+1',
    },
    {
      id: 'downloads',
      label: m.desktopNav.downloads,
      icon: ArrowDownToLine,
      shortcut: isMac ? '⌘2' : 'Alt+2',
    },
    {
      id: 'library',
      label: m.desktopNav.library,
      icon: Library,
      shortcut: isMac ? '⌘3' : 'Alt+3',
    },
    {
      id: 'playlists',
      label: m.desktopNav.playlists,
      icon: ListMusic,
      shortcut: isMac ? '⌘4' : 'Alt+4',
    },
    {
      id: 'settings',
      label: m.desktopNav.settings,
      icon: Settings,
      shortcut: isMac ? '⌘5' : 'Alt+5',
    },
  ] as const

  return (
    <aside
      className="flex h-full w-[14.5rem] shrink-0 select-none flex-col border-e border-fg/[0.06] bg-shell/95 text-ink-300 backdrop-blur-xl"
      data-no-drag
    >
      {/* Brand & App Title */}
      <button
        type="button"
        onClick={() => onSelectTab('search')}
        className="group flex h-14 shrink-0 items-center gap-3 border-b border-fg/[0.06] px-4 text-start transition hover:bg-fg/[0.02]"
      >
        <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-lime-flash text-lime-ink shadow-md shadow-lime-flash/20 transition duration-200 group-active:scale-95">
          <AudioLines className="size-4.5" strokeWidth={2.4} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate font-display text-sm font-bold tracking-tight text-ink-100 group-hover:text-lime-flash transition-colors">
              {m.app.name}
            </span>
            <span className="rounded bg-lime-flash/15 px-1.5 pb-0.2 pt-1 text-[9px] font-bold text-lime-flash">
              v{info?.version || __APP_VERSION__}
            </span>
          </span>
          <span className="block truncate text-[10px] font-medium text-ink-500">
            {m.desktopNav.musicDownloader}
          </span>
        </span>
      </button>

      {/* Main Navigation */}
      <nav className="shrink-0 space-y-1 px-2.5 py-3" aria-label={m.desktopNav.navigationLabel}>
        {navItems.map(({ id, label, icon: Icon, shortcut }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'group relative flex h-10 w-full items-center gap-2.5 rounded-ctl px-3 text-xs font-semibold transition duration-150 active:scale-[0.985]',
                active
                  ? 'bg-lime-flash/[0.09] text-ink-100 border border-lime-flash/25 shadow-sm shadow-shade/40'
                  : 'text-ink-400 hover:bg-fg/[0.045] hover:text-ink-100 border border-transparent',
              )}
            >
              {active && (
                <span className="absolute inset-y-2 start-0 w-1 rounded-full bg-lime-flash shadow-sm shadow-lime-flash/40" />
              )}
              <Icon
                className={clsx(
                  'size-4 shrink-0 transition-colors',
                  active ? 'text-lime-flash' : 'text-ink-400 group-hover:text-ink-200',
                )}
                strokeWidth={active ? 2.3 : 2}
              />
              <span className="min-w-0 flex-1 truncate text-start">{label}</span>

              {/* Downloads live counter */}
              {id === 'downloads' && activeCount > 0 ? (
                <span className="flex items-center gap-1 rounded-full bg-lime-flash px-2 py-0.5 text-[10px] font-bold text-lime-ink shadow-sm shadow-lime-flash/25">
                  <LoaderCircle className="size-2.5 animate-spin" />
                  <span className="tabular-nums">{m.app.num(activeCount)}</span>
                </span>
              ) : id === 'downloads' && entries.length > 0 ? (
                <span className="min-w-5 rounded-full bg-fg/[0.07] px-1.5 py-0.5 text-center text-[10px] font-medium text-ink-400 tabular-nums">
                  {m.app.num(entries.length)}
                </span>
              ) : (
                <kbd className="hidden group-hover:inline-block text-[9px] font-mono text-ink-500 opacity-60">
                  {shortcut}
                </kbd>
              )}
            </button>
          )
        })}
      </nav>

      {/* The person's playlists, one click from anywhere */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {playlists && playlists.length > 0 && (
          <>
            <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold text-ink-500">
              {m.desktopNav.playlists}
            </p>
            {playlists.map((playlist) => {
              const active = activeTab === 'playlists' && activePlaylist === playlist.id
              return (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => onOpenPlaylist?.(playlist.id)}
                  aria-label={m.playlists.open(playlist.name)}
                  className={clsx(
                    'flex h-9 w-full items-center gap-2.5 rounded-ctl px-2 text-start transition',
                    active
                      ? 'bg-fg/[0.06] text-ink-100'
                      : 'text-ink-400 hover:bg-fg/[0.04] hover:text-ink-100',
                  )}
                >
                  <PlaylistCover
                    covers={playlist.covers}
                    className="size-6"
                    rounded="rounded-md"
                    iconClassName="size-3"
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium" dir="auto">
                    {playlist.name}
                  </span>
                </button>
              )
            })}
          </>
        )}
      </div>

      {/* Now Playing Mini-Player in Sidebar (if active) */}
      {current && (
        <div className="mx-2.5 mb-2 rounded-panel border border-fg/[0.08] bg-fg/[0.035] p-2.5 shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onOpenKaraoke}
              className="relative size-10 shrink-0 overflow-hidden rounded-ctl shadow-md group/art"
              title={m.player.karaoke}
            >
              <Artwork
                src={current.coverUrl}
                alt={current.title}
                className="size-full object-cover"
              />
              {playing && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <PlayingBars className="h-3 text-lime-flash" />
                </div>
              )}
            </button>

            <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpenKaraoke}>
              <p
                className="truncate text-mini font-semibold text-ink-100 hover:text-lime-flash transition-colors text-start"
                dir="auto"
              >
                {current.title}
              </p>
              <p className="truncate text-[10px] text-ink-400 text-start" dir="auto">
                {current.artist}
              </p>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggle()
              }}
              className="grid size-7 shrink-0 place-items-center rounded-full bg-lime-flash text-lime-ink transition hover:bg-lime-soft active:scale-95 shadow-sm"
              title={playing ? m.player.pause : m.player.play}
            >
              {playing ? (
                <Pause className="size-3.5 fill-current" />
              ) : (
                <Play className="size-3.5 fill-current translate-x-[0.5px]" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Downloads Directory */}
      <div className="border-t border-fg/[0.06] p-3 space-y-2 bg-well/20">
        <div className="flex items-center justify-between px-1 text-[10px] font-semibold text-ink-400">
          <span>{m.settings.downloadsFolder}</span>
          <button
            type="button"
            onClick={handlePickFolder}
            className="rounded px-1.5 py-0.5 transition hover:bg-fg/[0.08] hover:text-lime-flash"
          >
            {m.settings.changeFolder}
          </button>
        </div>

        <button
          type="button"
          onClick={handleOpenFolder}
          title={m.settings.openInFinder}
          dir="ltr"
          className="group flex h-8.5 w-full items-center gap-2 rounded-ctl border border-fg/[0.07] bg-fg/[0.03] px-2.5 text-start transition hover:border-lime-flash/30 hover:bg-fg/[0.06] active:scale-[0.985]"
        >
          <FolderOpen className="size-3.5 shrink-0 text-ink-400 transition group-hover:text-lime-flash" />
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-400 group-hover:text-ink-200">
            {displayPath}
          </span>
        </button>
      </div>
    </aside>
  )
}
