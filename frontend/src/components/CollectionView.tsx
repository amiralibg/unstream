import { useMemo, useState, type CSSProperties } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Archive,
  Check,
  Download,
  Link2,
  ListPlus,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {
  apiError,
  jobZipUrl,
  trackInput,
  type Collection,
  type JobTrack,
  type Track,
} from '../lib/api'
import { useDownloads } from '../lib/downloads'
import { faNumerals, useMessages, useStartAlign } from '../lib/i18n'
import { useOptionalPlayer } from '../lib/player'
import { streamQueueItem, useAddToPlaylist } from '../lib/playlists'
import { useToast } from '../lib/toast'
import { LyricsSheet } from './LyricsSheet'
import { SongMenu } from './SongMenu'
import { TrackRow } from './TrackRow'

interface Props {
  url: string
  collection: Collection
}

export function CollectionView({ url, collection }: Props) {
  const m = useMessages()
  const startAlign = useStartAlign()
  // Downloads live in the global store, so they keep running (and stay
  // visible in the dock) when the user navigates to another search.
  // A collection can spawn several jobs for the same URL — one "Download
  // all" plus any number of single-track ones — so merge them all here.
  const downloads = useDownloads()
  const { push } = useToast()
  // Expired jobs (files swept, or the server restarted) are dropped rather
  // than merged: their per-track links 404, and the honest thing for this
  // view to show is an album that is simply ready to download again.
  const entries = downloads.entriesForUrl(url).filter((e) => !e.expired)

  // Tracks the user ticked to download as one batch.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  // Track whose lyrics sheet is open, if any.
  const [lyricsTrack, setLyricsTrack] = useState<Track | null>(null)
  // Only the desktop mounts a player; the web keeps its previews.
  const player = useOptionalPlayer()
  const saveAsPlaylist = useAddToPlaylist()
  const streamItems = () => collection.tracks.map(streamQueueItem)
  const collectionPlaying =
    player !== null && collection.tracks.some((t) => player.current?.id === streamQueueItem(t).id)

  const copyLink = async () => {
    const share = `${window.location.origin}/?url=${encodeURIComponent(url)}`
    try {
      await navigator.clipboard.writeText(share)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      push(m.collection.copied, 'success')
    } catch {
      push(m.collection.copyFailed, 'error')
    }
  }

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectAll = () => setSelected(new Set(collection.tracks.map((t) => t.id)))
  const clearSelection = () => setSelected(new Set())

  const start = useMutation({
    mutationFn: () => downloads.start(url, collection),
    onSuccess: () => push(m.collection.queuedAll(collection.tracks.length, collection.name)),
    onError: (err) => push(apiError(err, m), 'error'),
  })

  const startSelected = useMutation({
    mutationFn: (ids: string[]) => downloads.start(url, collection, ids),
    onSuccess: (_data, ids) => {
      clearSelection()
      push(m.collection.queuedSome(ids.length))
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })

  const startTrack = useMutation({
    mutationFn: (track: Props['collection']['tracks'][number]) =>
      downloads.start(
        url,
        { ...collection, name: track.title, cover_url: track.cover_url ?? collection.cover_url },
        [track.id],
      ),
    onSuccess: (_data, track) => push(m.collection.queuedOne(track.title)),
    onError: (err) => push(apiError(err, m), 'error'),
  })

  // Latest job state per track id, plus which job it belongs to (for the
  // per-track mp3 link). Later entries win.
  const jobTracks = useMemo(() => {
    const map = new Map<string, { jobId: string; state: JobTrack }>()
    for (const entry of entries) {
      for (const t of entry.job?.tracks ?? []) {
        map.set(t.id, { jobId: entry.jobId, state: t })
      }
    }
    return map
  }, [entries])

  const totalMs = collection.tracks.reduce((sum, t) => sum + t.duration_ms, 0)
  const running = entries.some((e) => !e.job?.finished)
  const settled = entries.reduce((n, e) => n + (e.job ? e.job.done + e.job.failed : 0), 0)
  const queuedTotal = entries.reduce((n, e) => n + (e.job?.total ?? e.tracks.length), 0)
  const doneTotal = entries.reduce((n, e) => n + (e.job?.done ?? 0), 0)
  const failedTotal = entries.reduce((n, e) => n + (e.job?.failed ?? 0), 0)
  const allFinished = entries.length > 0 && !running
  const allTracksDone = collection.tracks.every((t) => jobTracks.get(t.id)?.state.status === 'done')
  // ZIP covers one job — offer it for the newest job that has files.
  const zipEntry = [...entries].reverse().find((e) => (e.job?.done ?? 0) > 0)

  return (
    <section className="overflow-hidden rounded-panel border border-ink-700 bg-ink-900">
      <div className="flex flex-wrap items-center gap-5 border-b border-ink-800 p-5 sm:p-6">
        {collection.cover_url ? (
          <img
            src={collection.cover_url}
            alt=""
            className="size-20 rounded-btn object-cover ring-1 ring-ink-700 sm:size-24"
          />
        ) : (
          <div className="grid size-20 place-items-center rounded-btn bg-ink-800 ring-1 ring-ink-700 sm:size-24">
            <Music2 className="size-8 text-ink-400" />
          </div>
        )}

        {/* basis keeps the title from being crushed on phones — the buttons
            wrap to their own row instead of truncating the name */}
        <div className="min-w-0 grow basis-40">
          <span className="text-micro font-semibold text-lime-flash">
            {m.collection.kinds[collection.kind]}
          </span>
          <h2
            className={clsx(
              'mt-1 truncate font-display text-2xl font-bold',
              faNumerals(collection.name),
              startAlign,
            )}
            dir="auto"
          >
            {collection.name}
          </h2>
          <p className="mt-1 text-mini text-ink-300">
            <span dir="auto">{collection.owner}</span>
            <span className="mx-1.5 text-ink-600">·</span>
            {m.collection.trackCount(collection.tracks.length)}
            {totalMs > 0 && (
              <>
                <span className="mx-1.5 text-ink-600">·</span>
                {m.collection.duration(totalMs)}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {player && collection.tracks.length > 0 && (
            <>
              <button
                type="button"
                onClick={() =>
                  collectionPlaying ? player.toggle() : player.playQueue(streamItems(), 0)
                }
                title={collectionPlaying && player.playing ? m.player.pause : m.player.playFull}
                aria-label={
                  collectionPlaying && player.playing ? m.player.pause : m.player.playFull
                }
                className="grid size-10 place-items-center rounded-btn bg-lime-flash text-lime-ink transition duration-200 hover:bg-lime-soft active:scale-95"
              >
                {collectionPlaying && player.playing ? (
                  <Pause className="size-4 fill-current" />
                ) : (
                  <Play className="size-4 translate-x-px fill-current" />
                )}
              </button>
              <button
                type="button"
                disabled={saveAsPlaylist.isPending}
                onClick={() =>
                  saveAsPlaylist.mutate({
                    target: { create: collection.name || m.playlists.title },
                    songs: collection.tracks.map(trackInput),
                  })
                }
                title={m.playlists.addAllTo}
                aria-label={m.playlists.addAllTo}
                className="grid size-10 place-items-center rounded-btn border border-ink-600 text-ink-300 transition duration-200 hover:border-ink-400 hover:text-ink-100 active:scale-95 disabled:opacity-50"
              >
                {saveAsPlaylist.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ListPlus className="size-4" />
                )}
              </button>
            </>
          )}
          <button
            onClick={copyLink}
            title={m.collection.copy}
            aria-label={m.collection.copyShort}
            className="grid size-10 place-items-center rounded-btn border border-ink-600 text-ink-300 transition duration-200 hover:border-ink-400 hover:text-ink-100 active:scale-95"
          >
            {copied ? (
              <Check className="size-4 animate-pop text-lime-flash" />
            ) : (
              <Link2 className="size-4" />
            )}
          </button>
          {zipEntry && (zipEntry.job?.total ?? zipEntry.tracks.length) > 1 && (
            <a
              href={jobZipUrl(zipEntry.jobId)}
              download
              className="flex animate-pop items-center gap-1.5 rounded-btn border border-ink-600 px-4 py-2.5 text-mini font-medium text-ink-100 transition duration-200 hover:border-ink-400 active:scale-[0.98]"
            >
              <Archive className="size-4" />
              ZIP ({m.app.num(zipEntry.job!.done)})
            </a>
          )}
          {selected.size > 0 ? (
            <>
              <button
                onClick={clearSelection}
                title={m.collection.clearSelection}
                aria-label={m.collection.clearSelection}
                className="grid size-10 place-items-center rounded-btn border border-ink-600 text-ink-300 transition duration-200 hover:border-ink-400 hover:text-ink-100 active:scale-95"
              >
                <X className="size-4" />
              </button>
              <button
                onClick={() => startSelected.mutate([...selected])}
                disabled={startSelected.isPending}
                className={clsx(
                  'flex animate-pop items-center gap-1.5 rounded-btn bg-lime-flash px-4 py-2.5 text-mini font-medium text-lime-ink',
                  'transition duration-200 hover:bg-lime-soft active:scale-[0.98]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {startSelected.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {m.collection.downloadSelected(selected.size)}
              </button>
            </>
          ) : (
            (running || !allTracksDone) && (
              <button
                onClick={() => start.mutate()}
                disabled={start.isPending || running}
                className={clsx(
                  'flex items-center gap-1.5 rounded-btn bg-lime-flash px-4 py-2.5 text-mini font-medium text-lime-ink',
                  'transition duration-200 hover:bg-lime-soft active:scale-[0.98]',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {running || start.isPending ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    {entries.length > 0
                      ? `${m.app.num(settled)}/${m.app.num(queuedTotal)}`
                      : m.collection.starting}
                  </>
                ) : (
                  <>
                    <Download className="size-4" />
                    {m.collection.downloadAll}
                  </>
                )}
              </button>
            )
          )}
        </div>
      </div>

      {(start.isError || startTrack.isError || startSelected.isError) && (
        <p
          role="alert"
          className="animate-fade-up border-b border-ink-800 bg-danger/10 px-5 py-3 text-mini text-danger"
        >
          {apiError(start.error ?? startTrack.error ?? startSelected.error, m)}
        </p>
      )}

      {/* Taller on a phone so the action's 44px hit area is contained by the
          row — left at py-2 it would reach past the divider and swallow taps
          meant for the first track's buttons. */}
      {collection.tracks.length > 1 && (
        <div className="flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/50 px-5 py-3 sm:py-2">
          {/* min-w-0 lets this shrink instead of shoving the action out of the
              row; the action itself never wraps, so "Select all" can't break
              across two lines the way it did at phone width. */}
          <span className="min-w-0 text-xs text-ink-400 tabular-nums">
            {selected.size > 0 ? (
              m.collection.selectedOf(selected.size, collection.tracks.length)
            ) : (
              <>
                {m.collection.trackCount(collection.tracks.length)}
                <span className="mx-1.5 text-ink-600">·</span>
                {/* The same instruction, at two lengths — the long one has no
                    room on a phone, and truncating it would cut mid-sentence. */}
                <span className="sm:hidden">{m.collection.tickShort}</span>
                <span className="hidden sm:inline">{m.collection.tickLong}</span>
              </>
            )}
          </span>
          <button
            onClick={selected.size === collection.tracks.length ? clearSelection : selectAll}
            className="tap-target shrink-0 text-xs font-medium whitespace-nowrap text-lime-flash transition hover:text-lime-soft"
          >
            {selected.size === collection.tracks.length
              ? m.collection.clearAll
              : m.collection.selectAll}
          </button>
        </div>
      )}

      <ol className="stagger">
        {collection.tracks.map((track, index) => {
          const tj = jobTracks.get(track.id)
          const queuing = startTrack.isPending && startTrack.variables?.id === track.id
          return (
            <TrackRow
              key={`${track.id}-${index}`}
              style={{ '--i': index } as CSSProperties}
              index={index + 1}
              track={track}
              jobId={tj?.jobId ?? null}
              state={tj?.state}
              downloading={queuing}
              onDownload={tj ? undefined : () => startTrack.mutate(track)}
              selected={selected.has(track.id)}
              onToggleSelect={
                collection.tracks.length > 1 ? () => toggleSelect(track.id) : undefined
              }
              onLyrics={() => setLyricsTrack(track)}
              onPlay={
                player
                  ? () => {
                      const id = streamQueueItem(track).id
                      if (player.current?.id === id) player.toggle()
                      else player.playQueue(streamItems(), index)
                    }
                  : undefined
              }
              playback={
                player
                  ? {
                      active: player.current?.id === streamQueueItem(track).id,
                      playing: player.playing,
                      loading: player.loading,
                    }
                  : undefined
              }
              menu={
                player ? (
                  <SongMenu
                    songs={() => [trackInput(track)]}
                    items={() => [streamQueueItem(track)]}
                    className="tap-target grid size-8 shrink-0 place-items-center rounded-ctl border border-ink-700 text-ink-400 transition duration-200 hover:border-lime-flash/50 hover:text-lime-flash active:scale-90 pointer-fine:opacity-60 pointer-fine:group-hover:opacity-100"
                  />
                ) : undefined
              }
            />
          )
        })}
      </ol>

      {allFinished && (
        <p className="flex animate-fade-up items-center gap-2 border-t border-ink-800 px-5 py-3.5 text-mini text-ink-300">
          <Check className="size-4 shrink-0 text-lime-flash" />
          {m.collection.finished(doneTotal, queuedTotal)}
          {failedTotal > 0 && (
            <span className="text-danger">· {m.collection.failedCount(failedTotal)}</span>
          )}
        </p>
      )}

      {lyricsTrack && <LyricsSheet track={lyricsTrack} onClose={() => setLyricsTrack(null)} />}
    </section>
  )
}
