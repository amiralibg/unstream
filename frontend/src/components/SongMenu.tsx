import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ListEnd, ListMusic, ListPlus, ListStart, LoaderCircle, Plus } from 'lucide-react'
import clsx from 'clsx'
import type { PlaylistTrackInput } from '../lib/api'
import { faNumerals, useMessages } from '../lib/i18n'
import { useOptionalPlayer, type QueueItem } from '../lib/player'
import { useAddToPlaylist, usePlaylists } from '../lib/playlists'
import { useToast } from '../lib/toast'

const WIDTH = 248
const GAP = 6

/** Where the panel goes: under the trigger, or over it when the window has
 *  no room below — the rows this hangs off run to the bottom of a scroller. */
function place(trigger: DOMRect, height: number, rtl: boolean) {
  const below = trigger.bottom + GAP + height <= window.innerHeight - 8
  const top = below ? trigger.bottom + GAP : Math.max(8, trigger.top - GAP - height)
  // Logical end: the trigger's trailing edge in the reading direction.
  const left = rtl
    ? Math.min(trigger.left, window.innerWidth - WIDTH - 8)
    : Math.max(8, trigger.right - WIDTH)
  return { top, left }
}

/** "Play next", "Add to queue" and "Add to playlist" for one song or many.
 *
 *  Rendered into a portal: the rows that carry it live in clipped, scrolling
 *  lists, and a menu that stays inside them gets cut off by the edge of the
 *  very list it is about. `songs` and `items` are functions so a long
 *  album's worth of objects is only built when someone actually picks. */
export function SongMenu({
  songs,
  items,
  label,
  className,
  trigger,
}: {
  songs: () => PlaylistTrackInput[]
  /** The same songs as the player wants them; omit to hide the queue rows. */
  items?: () => QueueItem[]
  label?: string
  className?: string
  trigger?: ReactNode
}) {
  const m = useMessages()
  const player = useOptionalPlayer()
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const add = useAddToPlaylist()
  const { data: playlists, isPending } = usePlaylists(open)

  const close = () => {
    setOpen(false)
    setNaming(false)
    setName('')
  }

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rtl = document.documentElement.dir === 'rtl'
    const height = panelRef.current?.offsetHeight ?? 280
    setPos(place(buttonRef.current.getBoundingClientRect(), height, rtl))
  }, [open, naming, playlists])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        buttonRef.current?.focus()
      }
    }
    // A scroll moves the trigger out from under a fixed panel; closing is
    // what every native menu does about that.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toQueue = (where: 'next' | 'end') => {
    if (!player || !items) return
    const list = items()
    if (where === 'next') {
      player.playNext(list)
      push(m.player.playingNext(list.length), 'success')
    } else {
      player.addToQueue(list)
      push(m.player.addedToQueue(list.length), 'success')
    }
    close()
  }

  const addTo = (target: { id: string; name: string } | { create: string }) => {
    add.mutate({ target, songs: songs() }, { onSettled: close })
  }

  const rowClass =
    'flex h-9 w-full items-center gap-2.5 rounded-ctl px-2.5 text-start text-mini text-ink-200 transition hover:bg-fg/[0.06] hover:text-ink-100 disabled:opacity-50'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (open) close()
          else setOpen(true)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? m.playlists.addTo}
        title={label ?? m.playlists.addTo}
        className={
          className ??
          'grid size-8 shrink-0 place-items-center rounded-ctl border border-ink-700 text-ink-400 transition duration-200 hover:border-lime-flash/50 hover:text-lime-flash active:scale-90'
        }
      >
        {trigger ?? <ListPlus className="size-4" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
            className="fixed z-[80] animate-fade-up rounded-panel border border-fg/[0.08] bg-panel/98 p-1.5 text-ink-100 shadow-2xl shadow-shade/60 backdrop-blur-xl"
          >
            {player && items && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={rowClass}
                  onClick={() => toQueue('next')}
                >
                  <ListStart className="size-4 shrink-0 text-ink-400" />
                  {m.player.playNext}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={rowClass}
                  onClick={() => toQueue('end')}
                >
                  <ListEnd className="size-4 shrink-0 text-ink-400" />
                  {m.player.addToQueue}
                </button>
                <div className="my-1.5 h-px bg-fg/[0.06]" />
              </>
            )}
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold text-ink-500">
              {m.playlists.addTo}
            </p>
            {naming ? (
              <form
                className="flex items-center gap-1.5 px-1 pb-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (name.trim()) addTo({ create: name.trim() })
                }}
              >
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={m.playlists.namePlaceholder}
                  dir="auto"
                  maxLength={200}
                  className="h-8 min-w-0 flex-1 rounded-ctl border border-fg/[0.1] bg-well/30 px-2 text-mini text-ink-100 outline-none placeholder:text-ink-500 focus:border-lime-flash/50"
                />
                <button
                  type="submit"
                  disabled={!name.trim() || add.isPending}
                  className="h-8 shrink-0 rounded-ctl bg-lime-flash px-2.5 text-micro font-bold text-lime-ink transition hover:bg-lime-soft disabled:opacity-50"
                >
                  {add.isPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    m.playlists.save
                  )}
                </button>
              </form>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={rowClass}
                onClick={() => setNaming(true)}
              >
                <Plus className="size-4 shrink-0 text-lime-flash" />
                {m.playlists.newWith}
              </button>
            )}
            <div className="max-h-56 overflow-y-auto">
              {isPending ? (
                <div className="grid h-9 place-items-center">
                  <LoaderCircle className="size-4 animate-spin text-ink-500" />
                </div>
              ) : (
                (playlists ?? []).map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    role="menuitem"
                    disabled={add.isPending}
                    className={rowClass}
                    onClick={() => addTo({ id: playlist.id, name: playlist.name })}
                  >
                    <ListMusic className="size-4 shrink-0 text-ink-400" />
                    <span
                      className={clsx('min-w-0 flex-1 truncate', faNumerals(playlist.name))}
                      dir="auto"
                    >
                      {playlist.name}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-500">
                      {m.app.num(playlist.count)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
