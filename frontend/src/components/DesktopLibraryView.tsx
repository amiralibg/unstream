import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownUp,
  Captions,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  TriangleAlert,
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

// Rows are a fixed 68px + 6px gap. The virtualizer needs the number, and
// keeping it here means the CSS and the maths can't drift apart.
const ROW_HEIGHT = 74

export function DesktopLibraryView() {
  const m = useMessages()
  const { current, playing, playQueue, toggle, shuffle, toggleShuffle } = usePlayer()
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  // Typing stays responsive on a large library: the input updates now, the
  // list re-filters at React's leisure.
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
    // localeCompare so Farsi titles sort as Farsi rather than by code point.
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
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#10130f]">
      <header className="shrink-0 border-b border-white/[0.055] bg-[#10130f]/95 px-7 pb-4 pt-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[68rem] items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-flash/75">
              {m.desktopNav.libraryEyebrow}
            </p>
            <h1 className="font-display text-[22px] font-bold tracking-[-0.025em] text-ink-100">
              {m.desktopNav.library}
            </h1>
            <p className="mt-1 text-xs text-ink-500">
              {tracks ? m.player.trackCount(visible.length) : m.player.searchLibrary}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {visible.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => playAt(0)}
                  className="flex h-9 items-center gap-1.5 rounded-[10px] bg-lime-flash px-3.5 text-[11px] font-bold text-lime-ink transition hover:bg-lime-soft active:scale-95"
                >
                  <Play className="size-3.5 translate-x-[1px]" />
                  {m.player.playAll}
                </button>
                <button
                  type="button"
                  onClick={shuffleAll}
                  title={m.player.shuffleAll}
                  aria-label={m.player.shuffleAll}
                  className="grid size-9 place-items-center rounded-[10px] border border-white/[0.065] bg-black/20 text-ink-400 transition hover:bg-white/[0.05] hover:text-lime-flash"
                >
                  <Shuffle className="size-3.5" />
                </button>
              </>
            )}
            <label className="flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.065] bg-black/20 px-2.5 text-ink-500 focus-within:border-lime-flash/40">
              <Search className="size-3.5 shrink-0" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={m.player.searchLibrary}
                dir="auto"
                className="w-40 bg-transparent text-[11px] text-ink-100 outline-none placeholder:text-ink-600"
              />
            </label>
            <button
              type="button"
              onClick={() => void refetch()}
              title={m.player.refresh}
              aria-label={m.player.refresh}
              className="grid size-9 place-items-center rounded-[10px] border border-white/[0.065] bg-black/20 text-ink-400 transition hover:bg-white/[0.05] hover:text-ink-100"
            >
              <RefreshCw className={clsx('size-3.5', isFetching && 'animate-spin')} />
            </button>
          </div>
        </div>

        {tracks && tracks.length > 0 && (
          <div className="mx-auto mt-3 flex max-w-[68rem] items-center gap-1.5">
            <ArrowDownUp className="size-3 shrink-0 text-ink-600" />
            {sorts.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSort(option.id)}
                aria-pressed={sort === option.id}
                className={clsx(
                  'rounded-full px-2.5 py-1 text-[10px] font-semibold transition',
                  sort === option.id
                    ? 'bg-lime-flash/15 text-lime-flash'
                    : 'text-ink-500 hover:bg-white/[0.05] hover:text-ink-200',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <div
        ref={rows.scrollRef}
        onScroll={rows.onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-7 py-5"
      >
        <div className="mx-auto max-w-[68rem]">
          {isPending ? (
            <ul className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <li
                  key={i}
                  className="shimmer h-[68px] rounded-[14px]"
                  style={{ animationDelay: `${i * 90}ms` }}
                />
              ))}
            </ul>
          ) : isError ? (
            <div className="flex min-h-[22rem] flex-col items-center justify-center text-center">
              <div className="grid size-14 place-items-center rounded-2xl border border-danger/25 bg-danger/[0.08] text-danger">
                <TriangleAlert className="size-6" strokeWidth={1.7} />
              </div>
              <p className="mt-4 max-w-xs text-xs leading-5 text-ink-400">{apiError(error, m)}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-5 flex h-9 items-center gap-2 rounded-[9px] bg-lime-flash px-4 text-xs font-bold text-lime-ink transition hover:bg-lime-soft active:scale-95"
              >
                <RefreshCw className="size-3.5" />
                {m.player.refresh}
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[22rem] flex-col items-center justify-center text-center">
              <div className="grid size-14 place-items-center rounded-2xl border border-white/[0.06] bg-white/[0.025] text-ink-500">
                <ListMusic className="size-6" strokeWidth={1.7} />
              </div>
              <h2 className="mt-4 font-display text-sm font-semibold text-ink-200">
                {tracks && tracks.length > 0 ? m.palette.empty : m.player.empty}
              </h2>
              {!(tracks && tracks.length > 0) && (
                <p className="mt-1 max-w-xs text-xs leading-5 text-ink-500">{m.player.emptyHint}</p>
              )}
            </div>
          ) : (
            // Only the rows on screen are mounted; the spacer carries the
            // scrollbar so the list still feels its real length.
            <div style={{ height: rows.totalHeight }} className="relative">
              <ul
                className="absolute inset-x-0 top-0 space-y-1.5"
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
                          'group flex h-full w-full items-center gap-3.5 rounded-[14px] border p-3 text-start transition active:scale-[0.995]',
                          active
                            ? 'border-lime-flash/25 bg-lime-flash/[0.06]'
                            : 'border-white/[0.05] bg-white/[0.02] hover:border-white/[0.1] hover:bg-white/[0.04]',
                        )}
                      >
                        <Artwork
                          src={track.has_cover ? libraryCoverUrl(track.id) : undefined}
                          hasCover={track.has_cover}
                          className="size-11"
                          overlay={
                            active && playing ? (
                              <span className="absolute inset-0 grid place-items-center bg-black/55">
                                <PlayingBars />
                              </span>
                            ) : undefined
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={clsx(
                              'block truncate text-[13px] font-semibold',
                              active ? 'text-lime-flash' : 'text-ink-100',
                              faNumerals(track.title),
                            )}
                            dir="auto"
                          >
                            {track.title}
                          </span>
                          <span
                            className={clsx(
                              'mt-0.5 block truncate text-[11px] text-ink-500',
                              faNumerals(track.artist || m.player.unknownArtist),
                            )}
                            dir="auto"
                          >
                            {track.artist || m.player.unknownArtist}
                            {track.album ? ` · ${track.album}` : ''}
                          </span>
                        </span>
                        {track.has_lyrics && (
                          <Captions
                            className="size-3.5 shrink-0 text-lime-flash/70"
                            aria-label={m.lyrics.label}
                          />
                        )}
                        <span className="shrink-0 text-[10px] tabular-nums text-ink-600">
                          {fmtDuration(track.duration_ms, m)}
                        </span>
                        <span
                          className={clsx(
                            'grid size-8 shrink-0 place-items-center rounded-full transition',
                            active
                              ? 'bg-lime-flash text-lime-ink'
                              : 'bg-white/[0.05] text-ink-300 group-hover:bg-lime-flash group-hover:text-lime-ink',
                          )}
                        >
                          {active && playing ? (
                            <Pause className="size-3.5" />
                          ) : (
                            <Play className="size-3.5 translate-x-[1px]" />
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {isFetching && !isPending && (
            <p className="flex items-center justify-center gap-2 py-4 text-[11px] text-ink-600">
              <LoaderCircle className="size-3 animate-spin" />
              {m.player.refresh}…
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
