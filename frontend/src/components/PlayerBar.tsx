import { useEffect } from 'react'
import {
  Captions,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { faNumerals, useMessages } from '../lib/i18n'
import type { Messages } from '../lib/locales/en'
import { usePlayer, usePlayerTime, usePlayerVolume } from '../lib/player'
import { Artwork } from './Artwork'

function clock(seconds: number, m: Messages): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const min = Math.floor(total / 60)
  const sec = String(total % 60).padStart(2, '0')
  return `${m.app.num(min)}:${m.app.num(sec)}`
}

/** The scrubber and its clock, alone in their own component.
 *
 *  They are the only things that read the playhead, so they are the only
 *  things that re-render four times a second — the rest of the bar renders
 *  when the track changes. */
function Scrubber({ m }: { m: Messages }) {
  const { time, duration } = usePlayerTime()
  const { seekTo } = usePlayer()
  const max = duration > 0 ? duration : 0
  const progress = max > 0 ? Math.min(1, time / max) : 0

  return (
    // Physical LTR: a scrubber fills left-to-right in every locale, so the
    // elapsed clock has to sit on the side the fill starts from. Mirroring
    // this cluster is what put 0:11 on the right of a bar growing leftward.
    <div dir="ltr" className="hidden min-w-0 flex-1 items-center gap-2.5 md:flex">
      <span className="shrink-0 text-[10px] tabular-nums text-ink-500">{clock(time, m)}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.5}
        value={Math.min(time, max || time)}
        onChange={(e) => seekTo(Number(e.target.value))}
        aria-label={m.player.seek}
        dir="ltr"
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right, #c8f24f ${progress * 100}%, rgba(255,255,255,0.1) ${progress * 100}%)`,
        }}
      />
      <span className="shrink-0 text-[10px] tabular-nums text-ink-500">{clock(max, m)}</span>
    </div>
  )
}

function VolumeControl({ m }: { m: Messages }) {
  const { volume, muted, setVolume, toggleMute } = usePlayerVolume()
  const level = muted ? 0 : volume
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2

  return (
    <div dir="ltr" className="hidden shrink-0 items-center gap-1.5 lg:flex">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? m.player.unmute : m.player.mute}
        className="grid size-8 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.06] hover:text-ink-100 active:scale-90"
      >
        <Icon className="size-4" />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={level}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label={m.player.volume}
        dir="ltr"
        className="h-1 w-20 cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right, rgba(255,255,255,0.55) ${level * 100}%, rgba(255,255,255,0.1) ${level * 100}%)`,
        }}
      />
    </div>
  )
}

/** Persistent mini player pinned to the bottom of the desktop shell. Plays
 *  the on-disk library through the backend stream — no second download. */
export function PlayerBar({ onExpand }: { onExpand: () => void }) {
  const m = useMessages()
  const {
    current,
    playing,
    loading,
    failed,
    shuffle,
    repeat,
    toggle,
    next,
    prev,
    seekBy,
    toggleShuffle,
    cycleRepeat,
    stop,
  } = usePlayer()

  // Transport keys, but never while someone is typing — the filter box and
  // the search field both live a keystroke away from this bar.
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekBy(5)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekBy(-5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, toggle, seekBy])

  if (!current) return null

  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-[#0c0e0b]/95 px-4 py-2.5 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[68rem] items-center gap-3">
        <button
          type="button"
          onClick={onExpand}
          aria-label={m.player.karaoke}
          className="shrink-0 transition active:scale-95"
        >
          <Artwork
            src={current.coverUrl}
            hasCover={current.hasCover ?? Boolean(current.coverUrl)}
            className="size-10"
            iconClassName="size-4.5"
          />
        </button>

        <button
          type="button"
          onClick={onExpand}
          className="min-w-0 flex-1 text-start md:max-w-[15rem] md:flex-none"
          aria-label={m.player.karaoke}
        >
          <span
            className={clsx(
              'block truncate text-[13px] font-semibold',
              failed ? 'text-danger' : 'text-ink-100',
              faNumerals(current.title),
            )}
            dir="auto"
          >
            {current.title}
          </span>
          <span
            className={clsx(
              'mt-0.5 flex items-center gap-1 truncate text-[11px] text-ink-500',
              faNumerals(current.artist || m.player.unknownArtist),
            )}
            dir="auto"
          >
            {failed && <TriangleAlert className="size-3 shrink-0 text-danger" />}
            {failed ? m.player.unplayable : current.artist || m.player.unknownArtist}
          </span>
        </button>

        <div dir="ltr" className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-pressed={shuffle}
            aria-label={m.player.shuffle}
            title={m.player.shuffle}
            className={clsx(
              'hidden size-8 place-items-center rounded-full transition active:scale-90 sm:grid',
              shuffle ? 'text-lime-flash' : 'text-ink-500 hover:bg-white/[0.06] hover:text-ink-100',
            )}
          >
            <Shuffle className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={prev}
            aria-label={m.player.previous}
            className="grid size-8 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.06] hover:text-ink-100 active:scale-90"
          >
            <SkipBack className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? m.player.pause : m.player.play}
            className="grid size-9 place-items-center rounded-full bg-lime-flash text-lime-ink shadow-[0_4px_16px_rgba(200,242,79,0.25)] transition hover:bg-lime-soft active:scale-90"
          >
            {loading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-lime-ink/25 border-t-lime-ink" />
            ) : playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4 translate-x-[1px]" />
            )}
          </button>
          <button
            type="button"
            onClick={next}
            aria-label={m.player.next}
            className="grid size-8 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.06] hover:text-ink-100 active:scale-90"
          >
            <SkipForward className="size-4" />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            aria-pressed={repeat !== 'off'}
            aria-label={m.player.repeat[repeat]}
            title={m.player.repeat[repeat]}
            className={clsx(
              'hidden size-8 place-items-center rounded-full transition active:scale-90 sm:grid',
              repeat !== 'off'
                ? 'text-lime-flash'
                : 'text-ink-500 hover:bg-white/[0.06] hover:text-ink-100',
            )}
          >
            <RepeatIcon className="size-3.5" />
          </button>
        </div>

        <Scrubber m={m} />
        <VolumeControl m={m} />

        <button
          type="button"
          onClick={onExpand}
          aria-label={m.player.karaoke}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-white/[0.06] hover:text-lime-flash active:scale-90"
        >
          <Captions className="size-4" />
        </button>
        <button
          type="button"
          onClick={stop}
          aria-label={m.player.close}
          className="grid size-8 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-white/[0.06] hover:text-ink-200 active:scale-90"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
