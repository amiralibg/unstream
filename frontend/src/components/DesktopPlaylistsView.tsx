import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Download,
  FileDown,
  FileUp,
  GripVertical,
  HardDrive,
  ListMusic,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  Shuffle,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import {
  apiError,
  createPlaylist,
  deletePlaylist,
  exportPlaylist,
  importPlaylist,
  removeFromPlaylist,
  updatePlaylist,
  type JobTrack,
  type Playlist,
  type PlaylistFormat,
  type PlaylistSummary,
  type PlaylistTrack,
} from '../lib/api'
import { revealFile } from '../lib/desktop'
import { playlistDownloadUrl, useDownloads } from '../lib/downloads'
import { faNumerals, useMessages } from '../lib/i18n'
import { usePlayer } from '../lib/player'
import {
  playlistKey,
  playlistQueueItem,
  playlistsKey,
  usePlaylist,
  usePlaylists,
  useRefreshPlaylists,
} from '../lib/playlists'
import { useToast } from '../lib/toast'
import { Artwork, PlayingBars, PlaylistCover } from './Artwork'
import { fmtDuration } from './DesktopLibraryView'
import { SongMenu } from './SongMenu'

/** The id a playlist row has in the player's queue — what "is this the one
 *  playing" is asked against. */
const queueId = (entry: PlaylistTrack) => entry.file_id ?? `stream:${entry.uid}`

function NameForm({
  initial = '',
  onSubmit,
  onCancel,
  pending,
}: {
  initial?: string
  onSubmit: (name: string) => void
  onCancel: () => void
  pending?: boolean
}) {
  const m = useMessages()
  const [name, setName] = useState(initial)
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onSubmit(name.trim())
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        placeholder={m.playlists.namePlaceholder}
        maxLength={200}
        dir="auto"
        className="h-8 min-w-0 flex-1 rounded-ctl border border-fg/[0.1] bg-well/30 px-2.5 text-mini text-ink-100 outline-none placeholder:text-ink-500 focus:border-lime-flash/50"
      />
      <button
        type="submit"
        disabled={!name.trim() || pending}
        aria-label={m.playlists.save}
        className="grid size-8 shrink-0 place-items-center rounded-ctl bg-lime-flash text-lime-ink transition hover:bg-lime-soft disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label={m.playlists.cancel}
        className="grid size-8 shrink-0 place-items-center rounded-ctl text-ink-400 transition hover:bg-fg/[0.06] hover:text-ink-100"
      >
        <X className="size-3.5" />
      </button>
    </form>
  )
}

function ExportMenu({ playlist }: { playlist: Playlist }) {
  const m = useMessages()
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const run = useMutation({
    mutationFn: (format: PlaylistFormat) => exportPlaylist(playlist.id, format),
    onSuccess: (file) =>
      push(m.playlists.exported(file.filename), 'success', {
        label: m.desktopNav.revealInFolder,
        onClick: () => void revealFile(file.path),
      }),
    onError: (err) => push(apiError(err, m), 'error'),
    onSettled: () => setOpen(false),
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-ctl border border-fg/[0.08] bg-fg/[0.03] px-3 text-mini font-semibold text-ink-300 transition hover:border-fg/[0.15] hover:text-ink-100 active:scale-95"
      >
        {run.isPending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <FileDown className="size-3.5" />
        )}
        {m.playlists.export}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 top-full z-30 mt-1.5 w-72 animate-fade-up rounded-panel border border-fg/[0.08] bg-panel p-1.5 shadow-2xl shadow-shade/60"
        >
          {(['json', 'm3u8'] as const).map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              disabled={run.isPending}
              onClick={() => run.mutate(format)}
              className="flex w-full items-center gap-2.5 rounded-ctl px-2.5 py-2 text-start text-mini text-ink-200 transition hover:bg-fg/[0.06] hover:text-ink-100"
            >
              <FileDown className="size-4 shrink-0 text-ink-400" />
              {format === 'json' ? m.playlists.exportJson : m.playlists.exportM3u}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PlaylistDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const m = useMessages()
  const { push } = useToast()
  const client = useQueryClient()
  const refresh = useRefreshPlaylists()
  const downloads = useDownloads()
  const { current, playing, playQueue, toggle, shuffle, toggleShuffle } = usePlayer()
  const { data: playlist, isPending, isError, error } = usePlaylist(id)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useEffect(() => {
    setRenaming(false)
    setConfirmDelete(false)
  }, [id])

  const entries = downloads.entriesForUrl(playlistDownloadUrl(id)).filter((e) => !e.expired)
  const running = entries.some((e) => !e.job?.finished)
  const jobTracks = useMemo(() => {
    const map = new Map<string, JobTrack>()
    for (const entry of entries) for (const t of entry.job?.tracks ?? []) map.set(t.id, t)
    return map
  }, [entries])

  // Every song a job finishes is a row that just moved from "online" to "on
  // disk"; the playlist is re-read so the badge and the player's source move
  // with it.
  const doneCount = entries.reduce((n, e) => n + (e.job?.done ?? 0), 0)
  useEffect(() => {
    if (doneCount === 0) return
    void client.invalidateQueries({ queryKey: playlistKey(id) })
    void client.invalidateQueries({ queryKey: playlistsKey })
    void client.invalidateQueries({ queryKey: ['library'] })
  }, [doneCount, id, client])

  const rename = useMutation({
    mutationFn: (name: string) => updatePlaylist(id, { name }),
    onSuccess: (updated) => {
      refresh(updated)
      setRenaming(false)
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })

  const reorder = useMutation({
    mutationFn: (order: string[]) => updatePlaylist(id, { order }),
    onMutate: (order) => {
      // Moved on screen at once; the server's answer replaces it either way.
      const previous = client.getQueryData<Playlist>(playlistKey(id))
      if (previous) {
        const byUid = new Map(previous.tracks.map((t) => [t.uid, t]))
        client.setQueryData(playlistKey(id), {
          ...previous,
          tracks: order.map((uid) => byUid.get(uid)!).filter(Boolean),
        })
      }
      return { previous }
    },
    onSuccess: (updated) => refresh(updated),
    onError: (err, _order, context) => {
      if (context?.previous) client.setQueryData(playlistKey(id), context.previous)
      push(apiError(err, m), 'error')
    },
  })

  const remove = useMutation({
    mutationFn: (entry: PlaylistTrack) => removeFromPlaylist(id, entry.uid),
    onSuccess: (updated, entry) => {
      refresh(updated)
      push(m.playlists.removed(entry.title), 'info')
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })

  const destroy = useMutation({
    mutationFn: () => deletePlaylist(id),
    onSuccess: () => {
      push(m.playlists.deleted(playlist?.name ?? ''), 'info')
      client.removeQueries({ queryKey: playlistKey(id) })
      // Off the list before it is refetched, or the view would step straight
      // back onto the playlist it just deleted.
      client.setQueryData<PlaylistSummary[]>(playlistsKey, (old) => old?.filter((p) => p.id !== id))
      refresh()
      onDeleted()
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })

  const download = useMutation({
    mutationFn: () =>
      downloads.startPlaylist(id, playlist?.tracks.find((t) => t.cover)?.cover ?? null),
    onSuccess: (n) => push(m.playlists.queuedDownload(n, playlist?.name ?? ''), 'success'),
    onError: (err) => push(apiError(err, m), 'error'),
  })

  if (isPending) {
    return (
      <div className="space-y-2.5 p-8">
        <div className="shimmer h-28 rounded-panel" />
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="shimmer h-14 rounded-panel"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    )
  }
  if (isError || !playlist) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <TriangleAlert className="mb-3 size-6 text-danger" />
        <p className="max-w-xs text-mini text-ink-300">{apiError(error, m)}</p>
      </div>
    )
  }

  const tracks = playlist.tracks
  const items = () => tracks.map(playlistQueueItem)
  const onDisk = tracks.filter((t) => t.file_id).length
  const missing = tracks.length - onDisk
  const totalMs = tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0)
  const covers = [...new Set(tracks.map((t) => t.cover).filter((c): c is string => Boolean(c)))]
  const playlistIsPlaying = tracks.some((t) => current?.id === queueId(t))

  const playFrom = (at: number) => {
    if (tracks.length === 0) return
    playQueue(items(), at)
  }

  const shuffleAll = () => {
    if (tracks.length === 0) return
    if (!shuffle) toggleShuffle()
    playFrom(Math.floor(Math.random() * tracks.length))
  }

  const drop = (to: number) => {
    if (dragFrom === null || dragFrom === to) return
    const order = tracks.map((t) => t.uid)
    const [moved] = order.splice(dragFrom, 1)
    order.splice(to, 0, moved)
    reorder.mutate(order)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-fg/[0.06] px-7 py-6">
        <div className="flex flex-wrap items-end gap-5">
          <PlaylistCover
            covers={covers}
            className="size-28 shadow-xl shadow-shade/50"
            iconClassName="size-9"
          />
          <div className="min-w-0 flex-1 basis-56">
            <span className="text-micro font-semibold text-lime-flash">
              {m.collection.kinds.playlist}
            </span>
            {renaming ? (
              <div className="mt-1.5 max-w-sm">
                <NameForm
                  initial={playlist.name}
                  pending={rename.isPending}
                  onSubmit={(name) => rename.mutate(name)}
                  onCancel={() => setRenaming(false)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                title={m.playlists.rename}
                className="group/name mt-1 flex max-w-full items-center gap-2 text-start"
              >
                <h1
                  className={clsx(
                    'truncate font-display text-3xl font-bold tracking-tight text-ink-100',
                    faNumerals(playlist.name),
                  )}
                  dir="auto"
                >
                  {playlist.name}
                </h1>
                <Pencil className="size-3.5 shrink-0 text-ink-500 opacity-0 transition group-hover/name:opacity-100" />
              </button>
            )}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-mini text-ink-400">
              <span>{m.playlists.trackCount(tracks.length)}</span>
              {totalMs > 0 && (
                <>
                  <span className="text-ink-600">·</span>
                  <span>{m.collection.duration(totalMs)}</span>
                </>
              )}
              {tracks.length > 0 && (
                <>
                  <span className="text-ink-600">·</span>
                  <span>{m.playlists.onDiskCount(onDisk, tracks.length)}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={tracks.length === 0}
            onClick={() => (playlistIsPlaying ? toggle() : playFrom(0))}
            className="flex h-9 items-center gap-1.5 rounded-btn bg-lime-flash px-4 text-mini font-bold text-ink-950 shadow-md shadow-lime-flash/20 transition hover:bg-lime-soft active:scale-95 disabled:opacity-40"
          >
            {playlistIsPlaying && playing ? (
              <Pause className="size-3.5 fill-current" />
            ) : (
              <Play className="size-3.5 translate-x-[0.5px] fill-current" />
            )}
            {playlistIsPlaying && playing ? m.player.pause : m.playlists.play}
          </button>
          <button
            type="button"
            disabled={tracks.length === 0}
            onClick={shuffleAll}
            aria-label={m.playlists.shuffle}
            title={m.playlists.shuffle}
            className="grid size-9 place-items-center rounded-ctl border border-fg/[0.08] bg-fg/[0.03] text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash active:scale-95 disabled:opacity-40"
          >
            <Shuffle className="size-3.5" />
          </button>
          {tracks.length > 0 &&
            (missing > 0 || running ? (
              <button
                type="button"
                disabled={download.isPending || running}
                onClick={() => download.mutate()}
                className="flex h-9 items-center gap-1.5 rounded-ctl border border-fg/[0.08] bg-fg/[0.03] px-3 text-mini font-semibold text-ink-200 transition hover:border-lime-flash/40 hover:text-lime-flash active:scale-95 disabled:opacity-60"
              >
                {download.isPending || running ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {missing === tracks.length
                  ? m.playlists.downloadAll
                  : m.playlists.downloadMissing(missing)}
              </button>
            ) : (
              <span className="flex h-9 items-center gap-1.5 px-2 text-mini font-semibold text-lime-flash">
                <Check className="size-3.5" />
                {m.playlists.allOnDisk}
              </span>
            ))}
          <SongMenu
            songs={() => tracks.map((t) => playlistQueueItem(t).song!)}
            items={items}
            label={m.player.addToQueue}
            className="grid size-9 place-items-center rounded-ctl border border-fg/[0.08] bg-fg/[0.03] text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash active:scale-95"
          />
          <div className="ms-auto flex items-center gap-2">
            <ExportMenu playlist={playlist} />
            {confirmDelete ? (
              <div className="flex items-center gap-1.5 rounded-ctl border border-danger/30 bg-danger/10 py-1 pe-1 ps-3">
                <span className="max-w-[16rem] truncate text-micro text-danger" dir="auto">
                  {m.playlists.deleteConfirm(playlist.name)}
                </span>
                <button
                  type="button"
                  onClick={() => destroy.mutate()}
                  disabled={destroy.isPending}
                  className="h-7 rounded-ctl bg-danger px-2.5 text-micro font-bold text-white transition hover:bg-danger/85"
                >
                  {m.playlists.delete}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  aria-label={m.playlists.cancel}
                  className="grid size-7 place-items-center rounded-ctl text-ink-300 hover:text-ink-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label={m.playlists.delete}
                title={m.playlists.delete}
                className="grid size-9 place-items-center rounded-ctl border border-fg/[0.08] bg-fg/[0.03] text-ink-400 transition hover:border-danger/40 hover:text-danger active:scale-95"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tracks.length === 0 ? (
          <div className="flex min-h-[18rem] flex-col items-center justify-center p-8 text-center">
            <ListMusic className="mb-3 size-7 text-ink-500" strokeWidth={1.75} />
            <h2 className="font-display text-base font-bold text-ink-100">
              {m.playlists.emptyPlaylist}
            </h2>
            <p className="mt-1.5 max-w-xs text-mini leading-relaxed text-ink-400">
              {m.playlists.emptyPlaylistHint}
            </p>
          </div>
        ) : (
          <ol className="space-y-1">
            {tracks.map((entry, at) => {
              const active = current?.id === queueId(entry)
              const job = jobTracks.get(entry.uid)
              const working =
                job &&
                (job.status === 'queued' ||
                  job.status === 'searching' ||
                  job.status === 'downloading' ||
                  job.status === 'tagging' ||
                  job.status === 'retrying')
              const artist = entry.artists.join(', ') || m.player.unknownArtist
              return (
                <li
                  key={entry.uid}
                  draggable
                  onDragStart={(e) => {
                    setDragFrom(at)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (dragFrom === null) return
                    e.preventDefault()
                    setDragOver(at)
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    drop(at)
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                  className={clsx(
                    'group flex items-center gap-2 rounded-panel border pe-2 transition',
                    active
                      ? 'border-lime-flash/30 bg-lime-flash/[0.07]'
                      : dragOver === at && dragFrom !== at
                        ? 'border-lime-flash/30 bg-lime-flash/[0.04]'
                        : 'border-transparent hover:border-fg/[0.06] hover:bg-fg/[0.03]',
                    dragFrom === at && 'opacity-40',
                  )}
                >
                  <GripVertical
                    className="ms-1.5 size-3.5 shrink-0 cursor-grab text-ink-700 group-hover:text-ink-400"
                    aria-label={m.player.dragToReorder}
                  />
                  <button
                    type="button"
                    onClick={() => (active ? toggle() : playFrom(at))}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-start"
                  >
                    <span className="w-6 shrink-0 text-end font-display text-mini tabular-nums text-ink-600">
                      {active && playing ? (
                        <PlayingBars className="h-3.5 justify-end" />
                      ) : (
                        m.app.num(at + 1)
                      )}
                    </span>
                    <Artwork
                      src={entry.cover ?? undefined}
                      hasCover={Boolean(entry.cover)}
                      className="size-10"
                      iconClassName="size-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          'block truncate text-mini font-semibold',
                          active ? 'text-lime-flash' : 'text-ink-100',
                          faNumerals(entry.title),
                        )}
                        dir="auto"
                      >
                        {entry.title}
                      </span>
                      <span
                        className={clsx(
                          'mt-0.5 block truncate text-micro text-ink-400',
                          faNumerals(artist),
                        )}
                        dir="auto"
                      >
                        {artist}
                        {entry.album ? ` · ${entry.album}` : ''}
                      </span>
                    </span>
                  </button>

                  {working ? (
                    <span className="shrink-0 animate-breathe text-micro tabular-nums text-ink-300">
                      {m.stages[job.status as keyof typeof m.stages]}
                      {job.status === 'downloading' &&
                        ` ${m.app.num(Math.round(job.progress * 100))}%`}
                    </span>
                  ) : job?.status === 'error' ? (
                    <span
                      className="flex shrink-0 items-center gap-1 text-micro text-danger"
                      title={job.error ?? undefined}
                    >
                      <TriangleAlert className="size-3" />
                      {m.track.failed}
                    </span>
                  ) : entry.file_id ? (
                    <span
                      className="hidden shrink-0 items-center gap-1 rounded bg-lime-flash/10 px-1.5 py-0.5 text-[10px] font-medium text-lime-flash sm:inline-flex"
                      title={m.player.onDisk}
                    >
                      <HardDrive className="size-3" />
                      {m.player.onDisk}
                    </span>
                  ) : (
                    <span
                      className="hidden shrink-0 items-center gap-1 rounded bg-fg/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-ink-400 sm:inline-flex"
                      title={m.player.online}
                    >
                      <Radio className="size-3" />
                      {m.player.online}
                    </span>
                  )}

                  <span
                    className="w-11 shrink-0 text-end text-micro tabular-nums text-ink-400"
                    dir="ltr"
                  >
                    {fmtDuration(entry.duration_ms, m)}
                  </span>
                  <SongMenu
                    songs={() => [playlistQueueItem(entry).song!]}
                    items={() => [playlistQueueItem(entry)]}
                    label={m.player.more}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-ink-500 opacity-60 transition hover:bg-fg/[0.06] hover:text-lime-flash group-hover:opacity-100 active:scale-90"
                  />
                  <button
                    type="button"
                    onClick={() => remove.mutate(entry)}
                    aria-label={m.playlists.remove(entry.title)}
                    title={m.playlists.remove(entry.title)}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-ink-500 opacity-0 transition hover:bg-fg/[0.06] hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/** The person's own playlists: a list on one side, the open one on the
 *  other. Everything a playlist can do — play, stream what isn't on disk,
 *  download what's missing, export for another device — happens here. */
export function DesktopPlaylistsView({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const m = useMessages()
  const { push } = useToast()
  const refresh = useRefreshPlaylists()
  const { data: playlists, isPending, isError, error } = usePlaylists()
  const [creating, setCreating] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Open the most recent playlist when none is chosen, and step off one
  // that has just been deleted.
  useEffect(() => {
    if (!playlists) return
    if (selectedId && playlists.some((p) => p.id === selectedId)) return
    onSelect(playlists[0]?.id ?? null)
  }, [playlists, selectedId, onSelect])

  const create = useMutation({
    mutationFn: (name: string) => createPlaylist(name),
    onSuccess: (playlist) => {
      refresh(playlist)
      setCreating(false)
      onSelect(playlist.id)
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })

  const importFile = useMutation({
    mutationFn: async (file: File) => importPlaylist(await file.text(), file.name),
    onSuccess: (playlist) => {
      refresh(playlist)
      onSelect(playlist.id)
      push(m.playlists.imported(playlist.name, playlist.tracks.length), 'success')
    },
    onError: (err) => push(apiError(err, m), 'error'),
  })

  return (
    <div className="flex h-full min-w-0 overflow-hidden bg-ink-950">
      <section className="flex w-[17rem] shrink-0 flex-col border-e border-fg/[0.06] bg-well/10">
        <header className="shrink-0 space-y-3 border-b border-fg/[0.06] px-4 py-5">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-ink-100">
              {m.playlists.title}
            </h1>
            <p className="mt-1 text-micro leading-relaxed text-ink-500">{m.playlists.subtitle}</p>
          </div>
          {creating ? (
            <NameForm
              pending={create.isPending}
              onSubmit={(name) => create.mutate(name)}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-ctl bg-lime-flash px-3 text-micro font-bold text-ink-950 transition hover:bg-lime-soft active:scale-95"
              >
                <Plus className="size-3.5" />
                {m.playlists.create}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={importFile.isPending}
                title={m.playlists.importHint}
                className="flex h-8 items-center gap-1.5 rounded-ctl border border-fg/[0.08] bg-fg/[0.03] px-3 text-micro font-semibold text-ink-300 transition hover:border-fg/[0.15] hover:text-ink-100 active:scale-95 disabled:opacity-60"
              >
                {importFile.isPending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <FileUp className="size-3.5" />
                )}
                {m.playlists.import}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.m3u,.m3u8,application/json,audio/x-mpegurl,audio/mpegurl"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) importFile.mutate(file)
                }}
              />
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isPending ? (
            Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="shimmer mb-1.5 h-14 rounded-ctl" />
            ))
          ) : isError ? (
            <p className="p-3 text-mini text-danger">{apiError(error, m)}</p>
          ) : playlists.length === 0 ? (
            <p className="p-3 text-mini text-ink-500">{m.playlists.noneYet}</p>
          ) : (
            playlists.map((playlist) => {
              const active = playlist.id === selectedId
              return (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => onSelect(playlist.id)}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'mb-1 flex w-full items-center gap-3 rounded-ctl border p-2 text-start transition',
                    active
                      ? 'border-lime-flash/25 bg-lime-flash/[0.08]'
                      : 'border-transparent hover:bg-fg/[0.04]',
                  )}
                >
                  <PlaylistCover
                    covers={playlist.covers}
                    className="size-10"
                    iconClassName="size-4"
                    rounded="rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        'block truncate text-mini font-semibold',
                        active ? 'text-lime-flash' : 'text-ink-100',
                        faNumerals(playlist.name),
                      )}
                      dir="auto"
                    >
                      {playlist.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                      {m.playlists.trackCount(playlist.count)}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </section>

      <section className="min-w-0 flex-1">
        {selectedId ? (
          <PlaylistDetail key={selectedId} id={selectedId} onDeleted={() => onSelect(null)} />
        ) : (
          !isPending && (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 grid size-14 place-items-center rounded-2xl border border-fg/[0.08] bg-fg/[0.03] text-ink-400 shadow-xl">
                <ListMusic className="size-6" strokeWidth={1.75} />
              </div>
              <h2 className="font-display text-base font-bold text-ink-100">{m.playlists.empty}</h2>
              <p className="mt-1.5 max-w-sm text-mini leading-relaxed text-ink-400">
                {m.playlists.emptyHint}
              </p>
            </div>
          )
        )}
      </section>
    </div>
  )
}
