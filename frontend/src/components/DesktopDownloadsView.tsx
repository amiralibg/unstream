import { useState } from 'react'
import {
  ArrowDownToLine,
  Check,
  CircleSlash,
  FolderOpen,
  LoaderCircle,
  Music2,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { qualityLabel, type Job, type JobTrack } from '../lib/api'
import { isDesktop, revealFile } from '../lib/desktop'
import { type DownloadEntry, useDownloads } from '../lib/downloads'
import { faNumerals, useMessages } from '../lib/i18n'

function inFlightFraction(job: Job): number {
  return job.tracks.reduce(
    (sum, track) =>
      track.status === 'downloading' || track.status === 'tagging' ? sum + track.progress : sum,
    0,
  )
}

type Filter = 'all' | 'active' | 'completed'

export function DesktopDownloadsView({ onGoToSearch }: { onGoToSearch: () => void }) {
  const m = useMessages()
  const { entries, activeCount, cancel, retry, retryOne, dismiss } = useDownloads()
  const [filter, setFilter] = useState<Filter>('all')
  const completedCount = Math.max(0, entries.length - activeCount)

  const filtered = entries.filter((entry) => {
    const finished = entry.expired || (entry.job?.finished ?? false)
    if (filter === 'active') return !finished
    if (filter === 'completed') return finished
    return true
  })

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: m.results.all, count: entries.length },
    { id: 'active', label: m.desktopNav.activeDownloads(activeCount), count: activeCount },
    { id: 'completed', label: m.desktopNav.completed, count: completedCount },
  ]

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#10130f]">
      <header className="shrink-0 border-b border-white/[0.055] bg-[#10130f]/95 px-7 pb-4 pt-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[68rem] items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-bold tracking-[-0.025em] text-ink-100">
              {m.desktopNav.downloads}
            </h1>
            <p className="mt-1 text-xs text-ink-500">
              {activeCount > 0
                ? m.dock.activeSummary(activeCount)
                : m.dock.doneSummary(entries.length)}
            </p>
          </div>

          <div className="flex h-9 shrink-0 items-center rounded-[10px] border border-white/[0.065] bg-black/20 p-1">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={clsx(
                  'flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[11px] font-semibold transition duration-150',
                  filter === item.id
                    ? 'bg-white/[0.09] text-ink-100 shadow-sm'
                    : 'text-ink-500 hover:text-ink-200',
                )}
              >
                <span className="max-w-28 truncate">{item.label}</span>
                <span
                  className={clsx(
                    'min-w-4 rounded-full px-1 text-center text-[9px] tabular-nums',
                    filter === item.id ? 'bg-lime-flash/15 text-lime-flash' : 'text-ink-600',
                  )}
                >
                  {m.app.num(item.count)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        <div className="mx-auto max-w-[68rem] space-y-3">
          {filtered.length === 0 ? (
            <div className="flex min-h-[22rem] animate-fade-up flex-col items-center justify-center text-center">
              <div className="grid size-14 place-items-center rounded-2xl border border-white/[0.06] bg-white/[0.025] text-ink-500 shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
                <ArrowDownToLine className="size-6" strokeWidth={1.7} />
              </div>
              <h2 className="mt-4 font-display text-sm font-semibold text-ink-200">
                {filter === 'all'
                  ? m.hero.appEmpty
                  : filter === 'active'
                    ? m.desktopNav.noActiveDownloads
                    : m.desktopNav.noCompletedDownloads}
              </h2>
              <p className="mt-1 max-w-xs text-xs leading-5 text-ink-500">
                {m.desktopNav.emptyDownloadsHint}
              </p>
              <button
                type="button"
                onClick={onGoToSearch}
                className="mt-5 flex h-9 items-center gap-2 rounded-[9px] bg-lime-flash px-4 text-xs font-bold text-lime-ink transition hover:bg-lime-soft active:scale-95"
              >
                <Search className="size-3.5" />
                {m.desktopNav.search}
              </button>
            </div>
          ) : (
            filtered
              .slice()
              .reverse()
              .map((entry) => (
                <DesktopJobCard
                  key={entry.jobId}
                  entry={entry}
                  onCancel={() => cancel(entry.jobId)}
                  onRetry={() => retry(entry.jobId)}
                  onDismiss={() => dismiss(entry.jobId)}
                  onRetryOne={(trackId) => retryOne(entry.jobId, trackId)}
                />
              ))
          )}
        </div>
      </div>
    </div>
  )
}

function DesktopJobCard({
  entry,
  onCancel,
  onRetry,
  onDismiss,
  onRetryOne,
}: {
  entry: DownloadEntry
  onCancel: () => Promise<void>
  onRetry: () => Promise<void>
  onDismiss: () => void
  onRetryOne: (trackId: string) => Promise<void>
}) {
  const m = useMessages()
  const job = entry.job
  const done = job?.done ?? 0
  const failed = job?.failed ?? 0
  const stopped = job?.cancelled ?? 0
  const total = job?.total ?? entry.tracks.length
  const expired = entry.expired === true
  const finished = expired || (job?.finished ?? false)
  const inFlight = job ? inFlightFraction(job) : 0
  const fraction = total ? Math.min(1, (done + failed + inFlight) / total) : 0
  const trackItems =
    job?.tracks ??
    entry.tracks.map((track) => ({
      id: track.id,
      status: 'queued' as const,
      progress: 0,
      error: null,
      path: null,
      ext: null,
    }))

  return (
    <article className="group overflow-hidden rounded-[14px] border border-white/[0.065] bg-white/[0.025] shadow-[0_10px_30px_rgba(0,0,0,0.12)] transition hover:border-white/[0.09] hover:bg-white/[0.033]">
      <div className="flex items-center gap-3.5 p-3.5">
        {entry.cover_url ? (
          <img
            src={entry.cover_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-12 shrink-0 rounded-[9px] object-cover shadow-md ring-1 ring-white/10"
          />
        ) : (
          <div className="grid size-12 shrink-0 place-items-center rounded-[9px] bg-white/[0.05] text-ink-500 ring-1 ring-white/[0.06]">
            <Music2 className="size-5" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              className={clsx(
                'truncate text-[13px] font-semibold text-ink-100',
                faNumerals(entry.name),
              )}
              dir="auto"
            >
              {entry.name}
            </h3>
            <span className="shrink-0 rounded-md border border-white/[0.06] bg-black/20 px-1.5 py-0.5 text-[9px] font-semibold text-ink-500">
              {qualityLabel(entry.quality, m)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-500">
            {finished ? (
              <span className="flex items-center gap-1.5 font-medium text-lime-flash">
                <Check className="size-3" strokeWidth={2.5} />
                {m.dock.progress(done, total)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-ink-300">
                <LoaderCircle className="size-3 animate-spin text-lime-flash" />
                {m.dock.progress(done, total)}
                {entry.etaSeconds ? <span>· {m.dock.eta(entry.etaSeconds)}</span> : null}
              </span>
            )}
            {failed > 0 && <span className="text-danger">· {m.dock.failedCount(failed)}</span>}
            {stopped > 0 && <span>· {m.dock.cancelledCount(stopped)}</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {finished ? (
            <>
              {failed > 0 && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-danger/25 bg-danger/[0.08] px-2.5 text-[11px] font-semibold text-danger transition hover:bg-danger/15"
                >
                  <RefreshCw className="size-3" />
                  {m.dock.retry}
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                className="grid size-8 place-items-center rounded-lg text-ink-500 opacity-60 transition hover:bg-white/[0.06] hover:text-ink-200 group-hover:opacity-100"
                title={m.dock.remove}
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.035] px-2.5 text-[11px] font-semibold text-ink-300 transition hover:bg-white/[0.07] hover:text-ink-100"
            >
              <X className="size-3" />
              {m.dock.cancel}
            </button>
          )}
        </div>
      </div>

      {!finished && (
        <div className="h-0.5 w-full bg-black/20" dir="ltr">
          <div
            className="h-full bg-lime-flash shadow-[0_0_8px_rgba(200,242,79,0.35)] transition-[width] duration-300"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}

      <ul className="max-h-60 divide-y divide-white/[0.045] overflow-y-auto border-t border-white/[0.045] bg-black/[0.08]">
        {trackItems.map((item) => {
          const track = entry.tracks.find((candidate) => candidate.id === item.id)
          const title = track?.title ?? item.id
          const state = item as JobTrack
          // On desktop the file is already on disk: a restart retires the
          // job server-side, but the path still reveals. Web links would
          // 404, so expired stays dead there.
          const available = state.status === 'done' && (!entry.expired || isDesktop())
          return (
            <li
              key={item.id}
              className="flex min-h-9 items-center justify-between gap-3 px-3.5 text-[11px] transition hover:bg-white/[0.025]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {state.status === 'done' ? (
                  <Check className="size-3 shrink-0 text-lime-flash" />
                ) : state.status === 'error' ? (
                  <TriangleAlert className="size-3 shrink-0 text-danger" />
                ) : state.status === 'cancelled' ? (
                  <CircleSlash className="size-3 shrink-0 text-ink-600" />
                ) : (
                  <LoaderCircle className="size-3 shrink-0 animate-spin text-lime-flash" />
                )}
                <span
                  className={clsx('truncate font-medium text-ink-300', faNumerals(title))}
                  dir="auto"
                >
                  {title}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {available ? (
                  <button
                    type="button"
                    onClick={() => state.path && revealFile(state.path)}
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 font-medium text-ink-500 transition hover:bg-white/[0.05] hover:text-lime-flash"
                  >
                    <FolderOpen className="size-3" />
                    {m.desktopNav.openFolder}
                  </button>
                ) : state.status === 'error' ? (
                  <button
                    type="button"
                    onClick={() => onRetryOne(state.id)}
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 font-medium text-danger transition hover:bg-danger/10"
                  >
                    <RefreshCw className="size-3" />
                    {m.dock.retry}
                  </button>
                ) : (
                  <span className="text-[10px] text-ink-500">
                    {state.status === 'downloading'
                      ? `${Math.round(state.progress * 100)}%`
                      : (m.stages[state.status as keyof typeof m.stages] ?? state.status)}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </article>
  )
}
