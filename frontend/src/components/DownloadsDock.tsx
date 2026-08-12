import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { apiError, jobZipUrl, trackFileUrl, qualityLabel, type Job, type JobTrack } from '../lib/api'
import { useDownloads, type DownloadEntry } from '../lib/downloads'
import { faNumerals, useMessages, useStartAlign } from '../lib/i18n'
import { useToast } from '../lib/toast'
import { ShareTrack } from './ShareTrack'

/** Working, but with no percentage to report — these get a travelling band
 *  instead of a width. Only `downloading` knows how far along it is. */
const INDETERMINATE = new Set(['searching', 'tagging', 'retrying'])
const isActive = (status: string) => status === 'downloading' || INDETERMINATE.has(status)

/** How far the unsettled tracks have got, as a track count. Counting settled
 *  tracks alone pinned a single-track job at 0% for the whole download and
 *  then jumped it to 100%. Tagging counts whole — the file is already down,
 *  only metadata is still being written. */
function inFlightFraction(job: Job): number {
  return job.tracks.reduce(
    (sum, t) => (t.status === 'downloading' || t.status === 'tagging' ? sum + t.progress : sum),
    0,
  )
}

function TrackLine({
  entry,
  state,
  showBar = true,
}: {
  entry: DownloadEntry
  state: JobTrack
  /** False when the card above is already drawing this track's progress. */
  showBar?: boolean
}) {
  const m = useMessages()
  const startAlign = useStartAlign()
  const track = entry.tracks.find((t) => t.id === state.id)
  const title = track ? track.title : state.id
  const available = state.status === 'done' && !entry.expired
  // "original" can land as m4a or opus depending on the upload, so the file
  // itself is the only honest source for this label.
  const ext = state.ext ?? 'mp3'
  const active = isActive(state.status)

  return (
    <li className="relative flex items-center gap-2.5 px-4 py-1.5">
      {state.status === 'done' ? (
        <Check className="size-3.5 shrink-0 animate-pop text-lime-flash" />
      ) : state.status === 'error' ? (
        <TriangleAlert className="size-3.5 shrink-0 text-danger" />
      ) : state.status === 'cancelled' ? (
        <X className="size-3.5 shrink-0 text-ink-500" />
      ) : state.status === 'queued' ? (
        <span className="grid size-3.5 shrink-0 place-items-center">
          <span className="size-1.5 rounded-full bg-ink-600" />
        </span>
      ) : (
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-lime-flash" />
      )}
      <p
        className={clsx(
          'min-w-0 flex-1 truncate text-mini',
          state.status === 'error' || state.status === 'cancelled'
            ? 'text-ink-400'
            : 'text-ink-100',
          faNumerals(title),
          startAlign,
        )}
        title={state.error ?? title}
        dir="auto"
      >
        {title}
      </p>
      {available ? (
        <>
          <ShareTrack
            jobId={entry.jobId}
            trackId={state.id}
            title={title}
            ext={ext}
            size="compact"
          />
          <a
            href={trackFileUrl(entry.jobId, state.id)}
            download
            title={m.dock.downloadFile(title, ext)}
            aria-label={m.dock.downloadFileLong(title, ext)}
            className="tap-target flex shrink-0 items-center gap-1 rounded-ctl border border-ink-600 px-2 py-0.5 text-micro font-medium text-lime-flash transition hover:border-lime-flash/50 hover:bg-ink-800"
          >
            <Download className="size-3" />
            {ext}
          </a>
        </>
      ) : state.status === 'error' ? (
        <span className="text-xs text-danger">{m.dock.failed}</span>
      ) : state.status === 'cancelled' ? (
        <span className="text-xs text-ink-400">{m.dock.cancelled}</span>
      ) : entry.expired ? (
        <span className="text-xs text-ink-400">{m.dock.deleted}</span>
      ) : (
        <span
          className={clsx(
            'text-xs text-ink-400 tabular-nums',
            state.status !== 'downloading' && 'animate-breathe',
          )}
        >
          {m.stages[state.status as keyof typeof m.stages]}
          {state.status === 'downloading' && ` ${m.app.num(Math.round(state.progress * 100))}%`}
        </span>
      )}

      {/* The hairline TrackRow draws under a downloading row. A percentage in
          text with nothing moving beside it reads as stalled. */}
      {showBar && active && !entry.expired && (
        <span className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-ink-800">
          {state.status === 'downloading' ? (
            <span
              className="block h-full bg-lime-flash/70 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(2, state.progress * 100)}%` }}
            />
          ) : (
            // No percentage to report — a travelling band beats a fake number.
            <span className="block h-full w-1/4 animate-sweep bg-lime-flash/50" />
          )}
        </span>
      )}
    </li>
  )
}

function JobCard({ entry, capped = true }: { entry: DownloadEntry; capped?: boolean }) {
  const { cancel, dismiss } = useDownloads()
  const { push } = useToast()
  const m = useMessages()
  const startAlign = useStartAlign()
  const [stopping, setStopping] = useState(false)
  const job = entry.job
  const done = job?.done ?? 0
  const failed = job?.failed ?? 0
  const total = job?.total ?? entry.tracks.length
  const expired = entry.expired === true
  const finished = expired || (job?.finished ?? false)
  const cancelled = job?.cancelled ?? false

  const stop = async () => {
    setStopping(true)
    try {
      await cancel(entry.jobId)
    } catch (err) {
      // The usual cause is a job the server has already forgotten, which is
      // to say one that is no longer running — worth saying, not worth
      // leaving the card stuck on a spinner over.
      push(apiError(err, m), 'error')
    } finally {
      setStopping(false)
    }
  }
  const inFlight = job ? inFlightFraction(job) : 0
  const fraction = total ? Math.min(1, (done + failed + inFlight) / total) : 0
  // ZIP is for batches — a single song is just the mp3 link on its row.
  const showZip = total > 1 && done > 0 && !expired

  // With one track, this bar and the row's own hairline are the same number
  // drawn twice. The card keeps it — it is the wider of the two and the one
  // the FAB ring mirrors — which means it also inherits the stages that have
  // no percentage, and the row below goes bare.
  const only = total === 1 ? job?.tracks[0] : undefined
  const sweeping = !!only && !expired && INDETERMINATE.has(only.status)

  return (
    <div className="border-b border-ink-800 last:border-b-0">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        {entry.cover_url ? (
          <img src={entry.cover_url} alt="" className="size-9 shrink-0 rounded-ctl object-cover" />
        ) : (
          <div className="size-9 shrink-0 rounded-ctl bg-ink-800" />
        )}
        <div className="min-w-0 flex-1">
          {/* The name needs `dir="auto"` to shape its own punctuation and to
              truncate at its own end, but the progress line under it is always
              in the UI's language — so the two would sit on opposite edges
              whenever they disagree. Alignment is stated physically for that
              reason; `text-start` here would resolve against the name and
              defeat it. */}
          <p
            className={clsx(
              'truncate text-mini font-medium text-ink-100',
              faNumerals(entry.name),
              startAlign,
            )}
            dir="auto"
          >
            {entry.name}
          </p>
          <p className="text-xs text-ink-400 tabular-nums">
            {expired ? (
              m.dock.expired
            ) : cancelled ? (
              // The count is the point: "stopped" alone reads as though the
              // tracks that did finish went with it, and they did not.
              <>
                {m.dock.stopped(done, total)}
                {failed > 0 && <span className="text-danger"> · {m.dock.failedCount(failed)}</span>}
              </>
            ) : finished ? (
              <>
                {m.dock.progress(done, total)}
                {failed > 0 && <span className="text-danger"> · {m.dock.failedCount(failed)}</span>}
              </>
            ) : (
              <>
                {m.app.num(done + failed)}/{m.app.num(total)}
                {failed > 0 && <span className="text-danger"> · {m.dock.failedCount(failed)}</span>}
                {entry.etaSeconds != null && (
                  <span className="text-ink-300"> · {m.dock.eta(entry.etaSeconds)}</span>
                )}
              </>
            )}
          </p>
        </div>
        <span
          title={
            entry.quality === 'original'
              ? m.dock.originalQuality
              : m.dock.encodedQuality(entry.quality)
          }
          className="shrink-0 rounded-ctl border border-ink-700 px-1.5 py-0.5 text-micro font-medium text-ink-400 tabular-nums"
        >
          {qualityLabel(entry.quality, m)}
        </span>
        {showZip && (
          <a
            href={jobZipUrl(entry.jobId)}
            download
            title={m.dock.zip}
            aria-label={m.dock.zipLong}
            className="tap-target grid size-7 shrink-0 place-items-center rounded-ctl border border-ink-600 text-ink-100 transition hover:border-lime-flash/50 hover:text-lime-flash"
          >
            <Archive className="size-3.5" />
          </a>
        )}
        {finished ? (
          <button
            onClick={() => dismiss(entry.jobId)}
            title={m.dock.remove}
            className="tap-target grid size-7 shrink-0 place-items-center rounded-ctl text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          // A stop square, not the X the finished card uses: the two sit in
          // the same corner and mean different things — one ends the work,
          // the other only clears the row once the work is over.
          <button
            onClick={stop}
            disabled={stopping}
            title={m.dock.cancel}
            aria-label={m.dock.cancelLong}
            className="tap-target grid size-7 shrink-0 place-items-center rounded-ctl text-ink-400 transition hover:bg-ink-800 hover:text-danger disabled:opacity-50"
          >
            {stopping ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3 fill-current" />
            )}
          </button>
        )}
      </div>
      <div className="mx-4 h-0.5 overflow-hidden rounded-full bg-ink-800">
        {sweeping ? (
          <div className="h-full w-1/4 animate-sweep rounded-full bg-lime-flash/70" />
        ) : (
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-500 ease-out',
              // A stopped bar goes grey wherever it stopped. Left lime it
              // reads as still running; red would call the user's own
              // decision a failure.
              cancelled ? 'bg-ink-600' : failed > 0 && done === 0 ? 'bg-danger' : 'bg-lime-flash',
            )}
            style={{ width: `${fraction * 100}%` }}
          />
        )}
      </div>
      {/* Capped only when it has neighbours: several jobs each need to keep
          their header reachable, so each gets a slice and scrolls inside it.
          A lone job instead grows to whatever the panel gives it and lets the
          panel do the scrolling — capped, it clipped its own list mid-row
          while the sheet below it sat empty. */}
      <ul className={clsx('py-1.5', capped && 'max-h-44 overflow-y-auto')}>
        {(job?.tracks ?? []).map((state) => (
          <TrackLine key={state.id} entry={entry} state={state} showBar={total > 1} />
        ))}
        {!job && (
          <li className="flex items-center gap-2.5 px-4 py-1.5 text-mini text-ink-400">
            <LoaderCircle className="size-3.5 animate-spin" />
            {m.dock.starting}
          </li>
        )}
      </ul>
    </div>
  )
}

/** True from Tailwind's `sm` up. Read in JS, not with `sm:` classes: the two
 *  layouts are different components, and rendering both to hide one would put
 *  a second copy of every job list in the DOM. */
function useIsDesktop(): boolean {
  const query = '(min-width: 40rem)'
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

const DISMISS_AFTER_PX = 90

/** The downloads list as a bottom sheet: full width, anchored to the edge it
 *  slid in from, dismissed by the scrim, the close button or a drag. */
function DownloadsSheet({
  summary,
  onClose,
  onHeight,
  children,
}: {
  summary: string
  onClose: () => void
  /** Publishes the sheet's rendered height so toasts can clear it. */
  onHeight: (px: number) => void
  children: ReactNode
}) {
  const m = useMessages()
  const [drag, setDrag] = useState(0)
  const startY = useRef<number | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)

  // Measured, not assumed: the sheet grows and shrinks with its job list.
  useEffect(() => {
    const node = sheetRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => onHeight(entry.contentRect.height))
    observer.observe(node)
    return () => {
      observer.disconnect()
      onHeight(0)
    }
  }, [onHeight])

  // Escape belongs to the sheet while it's up; App's global handler would
  // otherwise navigate back, which is not what "close this" means here.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return
    setDrag(Math.max(0, e.clientY - startY.current)) // downward only
  }
  const onPointerUp = () => {
    if (startY.current == null) return
    startY.current = null
    if (drag > DISMISS_AFTER_PX) {
      onClose() // unmounts; no point springing back first
      return
    }
    setDrag(0)
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 animate-scrim-in bg-ink-950/70 backdrop-blur-[2px]"
      />
      <section
        ref={sheetRef}
        aria-label={m.dock.heading}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined }}
        className={clsx(
          // A resting height, not a hug. Sized to its contents, one job made
          // the sheet a strip barely taller than the row in it — a notification
          // rather than a panel, with the grab handle somewhere new each time.
          // Proportional rather than a rem floor, so landscape can't push it
          // past the ceiling (min-height wins over max-height when they clash).
          'fixed inset-x-0 bottom-0 z-50 flex h-[60svh] max-h-[85svh] flex-col overflow-hidden',
          'rounded-t-panel border-t border-ink-700 bg-ink-900 shadow-2xl shadow-black/60',
          // Padding, not margin: the list scrolls to the bottom edge and its
          // last row must clear the home indicator.
          'pb-[var(--safe-bottom)]',
          // Both the entrance and the drag drive `transform`, so only one runs.
          drag ? 'transition-none' : 'animate-sheet-in',
        )}
      >
        <header
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="shrink-0 cursor-grab touch-none border-b border-ink-800 active:cursor-grabbing"
        >
          <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-ink-600" />
          <div className="flex items-center gap-3 px-4 pt-2 pb-3">
            <h2 className="text-micro font-semibold text-ink-400">{m.dock.heading}</h2>
            <span className="flex-1 text-xs text-ink-400 tabular-nums">{summary}</span>
            <button
              onClick={onClose}
              aria-label={m.dock.close}
              className="tap-target -m-1 grid size-7 shrink-0 place-items-center rounded-ctl text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </section>
    </>
  )
}

export function DownloadsDock() {
  const { entries, activeCount, panelOpen, setPanelOpen } = useDownloads()
  const isDesktop = useIsDesktop()
  const m = useMessages()

  // Toasts are full width on phones, so whatever this pins to the bottom edge
  // ends up under them. --dock-lift says how much room to leave, and this is
  // its only writer: the FAB's footprint, then the sheet's measured height,
  // and nothing on desktop where the two sit in opposite corners.
  const docked = entries.length > 0
  const sheetOpen = panelOpen && !isDesktop
  const [sheetHeight, setSheetHeight] = useState(0)
  useEffect(() => {
    const root = document.documentElement
    const lift = isDesktop ? 0 : sheetOpen ? sheetHeight : docked ? 76 : 0
    if (lift > 0) root.style.setProperty('--dock-lift', `${lift}px`)
    else root.style.removeProperty('--dock-lift')
    return () => {
      root.style.removeProperty('--dock-lift')
    }
  }, [docked, isDesktop, sheetOpen, sheetHeight])

  const close = useCallback(() => setPanelOpen(false), [setPanelOpen])

  if (!docked) return null

  // Same measure the cards use, so ring and bar can't disagree.
  const totals = entries.reduce(
    (acc, e) => ({
      settled: acc.settled + (e.job ? e.job.done + e.job.failed + inFlightFraction(e.job) : 0),
      total: acc.total + (e.job?.total ?? e.tracks.length),
    }),
    { settled: 0, total: 0 },
  )
  const fraction = totals.total ? Math.min(1, totals.settled / totals.total) : 0
  const summary =
    activeCount > 0 ? m.dock.activeSummary(activeCount) : m.dock.doneSummary(entries.length)
  const cards = [...entries]
    .reverse()
    .map((entry) => <JobCard key={entry.jobId} entry={entry} capped={entries.length > 1} />)

  return (
    <div className="fixed end-5 bottom-[calc(1.25rem+var(--safe-bottom))] z-50 flex flex-col items-end gap-3">
      {panelOpen && isDesktop && (
        <section
          aria-label={m.dock.heading}
          className="flex w-[min(24rem,calc(100vw-2.5rem))] animate-fade-up flex-col overflow-hidden rounded-panel border border-ink-700 bg-ink-900 shadow-2xl shadow-black/60"
        >
          <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
            <h2 className="text-micro font-semibold text-ink-400">{m.dock.heading}</h2>
            <span className="text-xs text-ink-400 tabular-nums">{summary}</span>
          </header>
          <div className="max-h-[55vh] overflow-y-auto">{cards}</div>
        </section>
      )}

      {sheetOpen && (
        <DownloadsSheet summary={summary} onClose={close} onHeight={setSheetHeight}>
          {cards}
        </DownloadsSheet>
      )}

      <button
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label={panelOpen ? m.dock.close : m.dock.show}
        className={clsx(
          'relative grid size-14 place-items-center rounded-full bg-lime-flash text-lime-ink shadow-lg shadow-black/40 transition duration-200 hover:bg-lime-soft hover:scale-105 active:scale-95',
          // The sheet owns the bottom edge and its own dismissal.
          sheetOpen && 'pointer-events-none opacity-0',
        )}
      >
        {/* progress ring around the button while anything is downloading */}
        {activeCount > 0 && (
          <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
            <circle
              cx="28"
              cy="28"
              r="26"
              fill="none"
              className="stroke-lime-ink/20"
              strokeWidth="2.5"
            />
            <circle
              cx="28"
              cy="28"
              r="26"
              fill="none"
              className="stroke-lime-ink transition-[stroke-dashoffset] duration-500"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 26}
              strokeDashoffset={2 * Math.PI * 26 * (1 - fraction)}
            />
          </svg>
        )}
        {panelOpen ? (
          <ChevronDown className="size-5" strokeWidth={2.25} />
        ) : (
          <ArrowDownToLine className="size-5" strokeWidth={2.25} />
        )}
        {activeCount > 0 && !panelOpen && (
          <span className="absolute -top-0.5 -end-0.5 grid min-w-5 animate-pop place-items-center rounded-full border border-lime-flash bg-ink-950 px-1 text-micro font-semibold text-lime-flash tabular-nums">
            {m.app.num(activeCount)}
          </span>
        )}
      </button>
    </div>
  )
}
