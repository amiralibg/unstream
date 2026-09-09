import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Captions,
  ChevronDown,
  CloudOff,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  SearchX,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import clsx from 'clsx'
import { apiError, getLibraryLyrics, getLyrics, type Lyrics, type Track } from '../lib/api'
import { isMacOS } from '../lib/desktop'
import { faNumerals, useMessages } from '../lib/i18n'
import type { Messages } from '../lib/locales/en'
import { usePlayer, usePlayerTime, type QueueItem } from '../lib/player'

export interface LyricLine {
  t: number
  text: string
}

/** Parse time-synced LRC. Every [mm:ss.xx] tag on a line gets its own entry
 *  so repeated choruses written once still light up each time they play. */
export function parseLRC(synced: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of synced.split('\n')) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (tags.length === 0) continue
    const text = raw.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim()
    if (!text) continue
    for (const tag of tags) {
      lines.push({ t: Number(tag[1]) * 60 + Number(tag[2]), text })
    }
  }
  return lines.sort((a, b) => a.t - b.t)
}

/** The synced roll: the line being sung, lit, with the rest waiting.
 *
 *  Split out because it is the only part that reads the playhead. The
 *  header, the backdrop and the transport render once per track; this
 *  re-renders on every tick, and it is a list of `<p>`s, so that is cheap.
 *
 *  Auto-scroll steps aside for a few seconds after a manual scroll —
 *  fighting someone reading ahead is the classic way these get annoying. */
function LyricRoll({ lines, onSeek }: { lines: LyricLine[]; onSeek: (t: number) => void }) {
  const { time } = usePlayerTime()
  const listRef = useRef<HTMLDivElement | null>(null)
  const manualUntil = useRef(0)

  // The line still singing: the latest one whose timestamp has passed.
  const active = useMemo(() => {
    let at = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= time + 0.15) at = i
      else break
    }
    return at
  }, [lines, time])

  useEffect(() => {
    if (Date.now() < manualUntil.current) return
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active])

  return (
    <div
      ref={listRef}
      onWheel={() => (manualUntil.current = Date.now() + 4000)}
      onTouchMove={() => (manualUntil.current = Date.now() + 4000)}
      className="min-h-0 flex-1 overflow-y-auto px-6 py-8"
    >
      <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-1 py-[28vh]">
        {lines.map((line, i) => {
          const isActive = i === active
          const isPast = i < active
          return (
            <button
              key={`${line.t}-${i}`}
              type="button"
              data-active={isActive || undefined}
              dir="auto"
              // Tapping a line jumps the song there — the fastest way back
              // to the verse you wanted to hear again.
              onClick={() => onSeek(line.t)}
              className={clsx(
                'w-full rounded-2xl px-4 py-2 text-center font-display leading-relaxed transition-all duration-300 hover:bg-white/[0.04]',
                faNumerals(line.text),
                isActive
                  ? 'scale-[1.04] text-[26px] font-bold text-lime-flash [text-shadow:0_0_28px_rgba(200,242,79,0.35)]'
                  : isPast
                    ? 'text-lg font-medium text-ink-500'
                    : 'text-xl font-semibold text-ink-300/70',
              )}
            >
              {line.text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Full-screen karaoke over whatever is playing.
 *
 *  Looks on disk first — the sidecar `.lrc` written at download time — and
 *  only then at the network. That ordering is the whole point on a desktop:
 *  a downloaded song should sing along with no connection at all.
 */
export function KaraokeView({ onClose }: { onClose: () => void }) {
  const m = useMessages()
  const { current, playing, toggle, next, prev, seekTo } = usePlayer()
  const retrying = useRef(false)

  const lyricTrack: Track | null = useMemo(() => {
    if (!current) return null
    return {
      id: `lib:${current.id}`,
      title: current.title,
      artists: current.artist ? [current.artist] : [],
      album: current.album,
      duration_ms: current.duration_ms,
      cover_url: null,
      track_number: 0,
      release_date: '',
      preview_url: null,
      source_url: null,
    }
  }, [current])

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['karaoke', current?.id],
    queryFn: async (): Promise<Lyrics> => {
      const force = retrying.current
      retrying.current = false
      const onDisk = force ? null : await getLibraryLyrics(current!.id)
      // Timings are what make this karaoke rather than a page of text, so
      // the ranking is synced-anywhere first, not on-disk first. A file
      // carrying a synced .lrc wins outright and needs no network; a file
      // with only the plain frame still lets the network try for timings,
      // and stands in when that fails or turns up nothing better.
      if (onDisk?.synced) return onDisk
      try {
        const online = await getLyrics(lyricTrack!, force)
        if (online.synced || !onDisk) return online
      } catch (err) {
        if (!onDisk) throw err
      }
      return onDisk
    },
    enabled: current !== null,
    staleTime: Infinity,
    retry: false,
  })

  const retry = useCallback(() => {
    // "Try again" means go past the file and ask the network afresh.
    retrying.current = true
    return refetch()
  }, [refetch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lines = useMemo(() => (data?.synced ? parseLRC(data.synced) : []), [data])

  if (!current || !lyricTrack) return null

  const plain = data?.plain ?? null
  const offline = data?.source === 'file'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0c09] animate-fade-up">
      {/* The album cover, blown up and blurred behind the words — the room
          the song is playing in, rather than a flat panel. */}
      {current.coverUrl && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={current.coverUrl}
            alt=""
            className="size-full scale-125 object-cover opacity-25 blur-[64px]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c09]/70 via-[#0a0c09]/85 to-[#0a0c09]" />
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <header
          // Physical LTR with the traffic-light inset: under RTL the badge
          // flipped into the top-left corner and sat beneath the macOS
          // window buttons, which are drawn by the OS over this overlay.
          dir="ltr"
          className="flex shrink-0 items-center gap-3 px-5 pt-5"
          style={{ paddingLeft: isMacOS() ? '86px' : undefined }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={m.player.close}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-ink-300 transition hover:bg-white/[0.08] hover:text-ink-100 active:scale-90"
          >
            <ChevronDown className="size-4.5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p
              className={clsx(
                'truncate font-display text-[15px] font-bold text-ink-100',
                faNumerals(current.title),
              )}
              dir="auto"
            >
              {current.title}
            </p>
            <p
              className={clsx(
                'mt-0.5 truncate text-xs text-ink-500',
                faNumerals(current.artist || m.player.unknownArtist),
              )}
              dir="auto"
            >
              {current.artist || m.player.unknownArtist}
            </p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime-flash/10 text-lime-flash ring-1 ring-lime-flash/20">
            <Captions className="size-4" />
          </span>
        </header>

        {isPending ? (
          <div className="mx-auto w-full max-w-xl flex-1 space-y-5 px-6 pt-24" aria-busy>
            {[88, 64, 76, 52, 82].map((w, i) => (
              <div key={i} className="shimmer mx-auto h-6 rounded-ctl" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : isError ? (
          <Centered>
            <EmptyState
              icon={<CloudOff className="size-6" strokeWidth={1.7} />}
              title={m.errors.noAnswer}
              hint={apiError(error, m)}
              retryLabel={m.lyrics.retry}
              onRetry={() => void retry()}
              retrying={isFetching}
            />
          </Centered>
        ) : lines.length > 0 ? (
          <LyricRoll lines={lines} onSeek={seekTo} />
        ) : plain ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
            <div className="mx-auto max-w-xl space-y-5">
              {plain
                .split(/\n{2,}/)
                .map((v) => v.trim())
                .filter(Boolean)
                .map((verse, i) => (
                  <div key={i} dir="auto" className={faNumerals(verse)}>
                    {verse.split('\n').map((line, j) => (
                      <p key={j} className="text-center text-lg leading-9 text-ink-100/85">
                        {line}
                      </p>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <Centered>
            <EmptyState
              icon={
                data?.status === 'unavailable' ? (
                  <CloudOff className="size-6" strokeWidth={1.7} />
                ) : (
                  <SearchX className="size-6" strokeWidth={1.7} />
                )
              }
              title={
                data?.status === 'unavailable' ? m.lyrics.unavailable.title : m.lyrics.absent.title
              }
              hint={
                data?.status === 'unavailable' ? m.lyrics.unavailable.hint : m.lyrics.absent.hint
              }
              retryLabel={m.lyrics.retry}
              onRetry={() => void retry()}
              retrying={isFetching}
            />
          </Centered>
        )}

        <Transport
          m={m}
          current={current}
          playing={playing}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          onSeek={seekTo}
          source={data?.source ?? null}
          offline={offline}
        />
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center px-6">{children}</div>
}

/** Transport under the words, so nobody has to leave karaoke to skip a
 *  track or scrub back to the chorus. */
function Transport({
  m,
  current,
  playing,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  source,
  offline,
}: {
  m: Messages
  current: QueueItem
  playing: boolean
  onToggle: () => void
  onNext: () => void
  onPrev: () => void
  onSeek: (t: number) => void
  source: string | null
  offline: boolean
}) {
  const { time, duration } = usePlayerTime()
  const max = duration > 0 ? duration : current.duration_ms / 1000
  const progress = max > 0 ? Math.min(1, time / max) : 0

  return (
    <footer className="shrink-0 border-t border-white/[0.06] bg-black/25 px-6 py-4 backdrop-blur-xl">
      <div dir="ltr" className="mx-auto flex max-w-xl flex-col gap-3">
        <input
          type="range"
          min={0}
          max={max || 0}
          step={0.5}
          value={Math.min(time, max || time)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label={m.player.seek}
          dir="ltr"
          className="h-1 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, #c8f24f ${progress * 100}%, rgba(255,255,255,0.12) ${progress * 100}%)`,
          }}
        />
        <div dir="ltr" className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={onPrev}
            aria-label={m.player.previous}
            className="grid size-9 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.07] hover:text-ink-100 active:scale-90"
          >
            <SkipBack className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? m.player.pause : m.player.play}
            className="grid size-11 place-items-center rounded-full bg-lime-flash text-lime-ink shadow-[0_6px_22px_rgba(200,242,79,0.28)] transition hover:bg-lime-soft active:scale-90"
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-[1px]" />}
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label={m.player.next}
            className="grid size-9 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.07] hover:text-ink-100 active:scale-90"
          >
            <SkipForward className="size-4.5" />
          </button>
        </div>
        {source && (
          <p className="flex items-center justify-center gap-1.5 text-[10px] text-ink-600">
            {offline ? (
              <>
                <HardDrive className="size-3" />
                {m.player.lyricsOnDisk}
              </>
            ) : (
              <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-semibold uppercase tracking-wider">
                {source}
              </span>
            )}
          </p>
        )}
      </div>
    </footer>
  )
}

function EmptyState({
  icon,
  title,
  hint,
  retryLabel,
  onRetry,
  retrying = false,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  retryLabel?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-ink-800/60 text-ink-400 ring-1 ring-ink-700">
        {icon}
      </span>
      <p className="max-w-64 text-body font-medium text-balance text-ink-100">{title}</p>
      {hint && <p className="max-w-60 text-mini text-pretty text-ink-400">{hint}</p>}
      {onRetry && retryLabel && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-1 flex items-center gap-1.5 rounded-btn border border-ink-600 px-4 py-2 text-mini font-medium text-ink-100 transition hover:border-ink-400 hover:bg-ink-800 active:scale-95 disabled:opacity-60"
        >
          <RefreshCw className={clsx('size-3.5', retrying && 'animate-spin')} />
          {retryLabel}
        </button>
      )}
    </div>
  )
}
