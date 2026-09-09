import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownUp,
  Captions,
  ListMusic,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  TriangleAlert,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {
  apiError,
  getLibrary,
  libraryCoverUrl,
  libraryFileUrl,
  type LibraryTrack,
} from '../lib/api'
import { faNumerals, useMessages } from '../lib/i18n'
import type { Messages } from '../lib/locales/en'
import { usePlayer, type QueueItem } from '../lib/player'
import { useVirtualRows } from '../lib/virtual'
import { Artwork, PlayingBars } from './Artwork'

export function toQueueItem(track: LibraryTrack): QueueItem {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration_ms: track.duration_ms,
    url: libraryFileUrl(track.id),
    coverUrl: track.has_cover ? libraryCoverUrl(track.id) : undefined,
    hasCover: track.has_cover,
  }
}

export function fmtDuration(durationMs: number, m: Messages): string {
  if (!durationMs || durationMs <= 0) return '--:--'
  const total = Math.round(durationMs / 1000)
  const min = Math.floor(total / 60)
  const sec = String(total % 60).padStart(2, '0')
  return `${m.app.num(min)}:${m.app.num(sec)}`
}

type SortKey = 'recent' | 'title' | 'artist'

// Rows are a fixed 68px + 6px gap. The virtualizer needs the number.
const ROW_HEIGHT = 74

export function DesktopLibraryView() {
  const m = useMessages()
  const { current, playing, playQueue, toggle, shuffle, toggleShuffle } = usePlayer()
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const query = useDeferredValue(filter)

  const {
    data: tracks,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['library'],
    queryFn: getLibrary,
    staleTime: 30_000,
    retry: false,
  })

  const visible = useMemo(() => {
    if (!tracks) return []
    const q = query.trim().toLowerCase()
    const rows = q
      ? tracks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q),
        )
      : tracks
    if (sort === 'recent') return rows
    const by = sort === 'title' ? (t: LibraryTrack) => t.title : (t: LibraryTrack) => t.artist
    return [...rows].sort((a, b) => by(a).localeCompare(by(b), undefined, { numeric: true }))
  }, [tracks, query, sort])

  const rows = useVirtualRows({ count: visible.length, rowHeight: ROW_HEIGHT })

  const playAt = (at: number) => {
    if (visible.length === 0) return
    playQueue(visible.map(toQueueItem), at)
  }

  const shuffleAll = () => {
    if (visible.length === 0) return
    if (!shuffle) toggleShuffle()
    playAt(Math.floor(Math.random() * visible.length))
  }

  const sorts: { id: SortKey; label: string }[] = [
    { id: 'recent', label: m.player.sortRecent },
    { id: 'title', label: m.player.sortTitle },
    { id: 'artist', label: m.player.sortArtist },
  ]

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-ink-950">
      {/* Library Header */}
      <header className="shrink-0 border-b border-white/[0.06] bg-ink-950/90 px-6 sm:px-8 py-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-end justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink-100">
                {m.desktopNav.library}
              </h1>
              {tracks && (
                <span className="rounded-full bg-lime-flash/15 border border-lime-flash/30 px-2.5 py-0.5 text-micro font-semibold text-lime-flash tabular-nums">
                  {m.player.trackCount(visible.length)}
                </span>
              )}
            </div>
            <p className="mt-1 text-mini text-ink-400">
              {tracks ? m.desktopNav.offlineLibrary : m.player.searchLibrary}
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {visible.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => playAt(0)}
                  className="flex h-9 items-center gap-1.5 rounded-btn bg-lime-flash px-4 text-mini font-bold text-ink-950 transition hover:bg-lime-soft active:scale-95 shadow-md shadow-lime-flash/20"
                >
                  <Play className="size-3.5 fill-current translate-x-[0.5px]" />
                  <span>{m.player.playAll}</span>
                </button>
                <button
                  type="button"
                  onClick={shuffleAll}
                  title={m.player.shuffleAll}
                  aria-label={m.player.shuffleAll}
                  className="grid size-9 place-items-center rounded-ctl border border-white/[0.08] bg-white/[0.03] text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash active:scale-95"
                >
                  <Shuffle className="size-3.5" />
                </button>
              </>
            )}

            {/* Quick Search */}
            <div className="relative flex h-9 items-center rounded-ctl border border-white/[0.08] bg-black/30 px-2.5 text-ink-400 focus-within:border-lime-flash/50 focus-within:text-ink-100">
              <Search className="size-3.5 shrink-0 text-ink-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={m.player.searchLibrary}
                dir="auto"
                className="w-36 sm:w-44 bg-transparent px-2 text-mini text-ink-100 outline-none placeholder:text-ink-500"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  className="grid size-4 place-items-center text-ink-400 hover:text-ink-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => void refetch()}
              title={m.player.refresh}
              aria-label={m.player.refresh}
              className="grid size-9 place-items-center rounded-ctl border border-white/[0.08] bg-white/[0.03] text-ink-400 transition hover:border-white/[0.15] hover:text-ink-100 active:scale-95"
            >
              <RefreshCw className={clsx('size-3.5', isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Sort Controls */}
        {tracks && tracks.length > 0 && (
          <div className="mx-auto mt-4 flex max-w-5xl items-center gap-2">
            <ArrowDownUp className="size-3 text-ink-500 shrink-0" />
            <div className="flex items-center gap-1.5">
              {sorts.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSort(option.id)}
                  aria-pressed={sort === option.id}
                  className={clsx(
                    'rounded-full px-3 py-1 text-micro font-semibold transition',
                    sort === option.id
                      ? 'bg-lime-flash/20 text-lime-flash border border-lime-flash/30'
                      : 'text-ink-400 hover:bg-white/[0.05] hover:text-ink-200 border border-transparent',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Library Tracks List */}
      <div
        ref={rows.scrollRef}
        onScroll={rows.onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-8 py-6"
      >
        <div className="mx-auto max-w-5xl">
          {isPending ? (
            <ul className="space-y-2.5">
              {Array.from({ length: 8 }, (_, i) => (
                <li
                  key={i}
                  className="shimmer h-[68px] rounded-panel border border-white/[0.04]"
                  style={{ animationDelay: `${i * 90}ms` }}
                />
              ))}
            </ul>
          ) : isError ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center text-center p-8">
              <div className="grid size-14 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger mb-4">
                <TriangleAlert className="size-6" strokeWidth={1.75} />
              </div>
              <p className="max-w-xs text-mini leading-relaxed text-ink-300">
                {apiError(error, m)}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-5 flex h-9.5 items-center gap-2 rounded-btn bg-lime-flash px-4 text-mini font-bold text-ink-950 transition hover:bg-lime-soft active:scale-95"
              >
                <RefreshCw className="size-3.5" />
                <span>{m.player.refresh}</span>
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[24rem] flex-col items-center justify-center text-center p-8">
              <div className="grid size-14 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-ink-400 mb-4 shadow-xl">
                <ListMusic className="size-6" strokeWidth={1.75} />
              </div>
              <h2 className="font-display text-base font-bold text-ink-100">
                {tracks && tracks.length > 0 ? m.palette.empty : m.player.empty}
              </h2>
              {!(tracks && tracks.length > 0) && (
                <p className="mt-1.5 max-w-xs text-mini leading-relaxed text-ink-400">
                  {m.player.emptyHint}
                </p>
              )}
            </div>
          ) : (
            <div style={{ height: rows.totalHeight }} className="relative">
              <ul
                className="absolute inset-x-0 top-0 space-y-2"
                style={{ transform: `translateY(${rows.offsetTop}px)` }}
              >
                {visible.slice(rows.start, rows.end).map((track, i) => {
                  const at = rows.start + i
                  const active = current?.id === track.id
                  return (
                    <li key={track.id} style={{ height: ROW_HEIGHT - 6 }}>
                      <button
                        type="button"
                        onClick={() => (active ? toggle() : playAt(at))}
                        className={clsx(
                          'group flex h-full w-full items-center gap-4 rounded-panel border p-3 text-start transition active:scale-[0.995]',
                          active
                            ? 'border-lime-flash/30 bg-lime-flash/[0.07] shadow-md shadow-black/40'
                            : 'border-white/[0.06] bg-ink-900/60 hover:border-white/[0.12] hover:bg-ink-900/90',
                        )}
                      >
                        {/* Artwork */}
                        <Artwork
                          src={track.has_cover ? libraryCoverUrl(track.id) : undefined}
                          hasCover={track.has_cover}
                          className="size-11 shrink-0 rounded-lg shadow"
                          overlay={
                            active && playing ? (
                              <span className="absolute inset-0 grid place-items-center bg-black/60 backdrop-blur-[1px]">
                                <PlayingBars className="h-4 text-lime-flash" />
                              </span>
                            ) : undefined
                          }
                        />

                        {/* Title & Artist */}
                        <span className="min-w-0 flex-1">
                          <span
                            className={clsx(
                              'block truncate text-mini font-bold',
                              active
                                ? 'text-lime-flash'
                                : 'text-ink-100 group-hover:text-lime-flash transition-colors',
                              faNumerals(track.title),
                            )}
                            dir="auto"
                          >
                            {track.title}
                          </span>
                          <span
                            className={clsx(
                              'mt-0.5 block truncate text-micro text-ink-400',
                              faNumerals(track.artist || m.player.unknownArtist),
                            )}
                            dir="auto"
                          >
                            {track.artist || m.player.unknownArtist}
                            {track.album ? ` · ${track.album}` : ''}
                          </span>
                        </span>

                        {/* Lyrics Badge */}
                        {track.has_lyrics && (
                          <span
                            className="hidden sm:inline-flex items-center gap-1 rounded bg-lime-flash/10 px-1.5 py-0.5 text-micro font-medium text-lime-flash"
                            title={m.lyrics.label}
                          >
                            <Captions className="size-3" />
                            <span>{m.lyrics.label}</span>
                          </span>
                        )}

                        {/* Duration */}
                        <span className="shrink-0 text-micro tabular-nums text-ink-400" dir="ltr">
                          {fmtDuration(track.duration_ms, m)}
                        </span>

                        {/* Play / Pause indicator button */}
                        <span
                          className={clsx(
                            'grid size-8 shrink-0 place-items-center rounded-full transition shadow-sm',
                            active
                              ? 'bg-lime-flash text-lime-ink'
                              : 'bg-white/[0.06] text-ink-300 group-hover:bg-lime-flash group-hover:text-lime-ink',
                          )}
                        >
                          {active && playing ? (
                            <Pause className="size-3.5 fill-current" />
                          ) : (
                            <Play className="size-3.5 fill-current translate-x-[0.5px]" />
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
