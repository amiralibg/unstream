import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** One playable row: a library file, with everything the bar and the
 *  karaoke view need without asking the backend again. */
export interface QueueItem {
  id: string
  title: string
  artist: string
  album: string
  duration_ms: number
  url: string
  coverUrl?: string
  hasCover?: boolean
}

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerContextValue {
  queue: QueueItem[]
  index: number
  current: QueueItem | null
  playing: boolean
  loading: boolean
  failed: boolean
  shuffle: boolean
  repeat: RepeatMode
  playQueue: (items: QueueItem[], startIndex: number) => void
  playAt: (index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seekTo: (seconds: number) => void
  seekBy: (delta: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  stop: () => void
}

/** Position, kept apart from everything else on purpose.
 *
 *  `timeupdate` fires ~4× a second. Behind one context that would re-render
 *  every consumer of the player — the whole desktop shell — four times a
 *  second for a number only the scrubber and the lyric roll care about.
 *  Splitting it means the sidebar, the library list and the track rows
 *  render when the *track* changes and never on a tick. */
interface PlayerTimeValue {
  time: number
  duration: number
}

/** Volume, split off for the same reason as position: dragging the slider
 *  fires continuously, and the library list has no stake in the result. */
interface PlayerVolumeValue {
  volume: number
  muted: boolean
  setVolume: (value: number) => void
  toggleMute: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)
const PlayerTimeContext = createContext<PlayerTimeValue>({ time: 0, duration: 0 })
const PlayerVolumeContext = createContext<PlayerVolumeValue | null>(null)

const VOLUME_KEY = 'unstream:volume'
const MUTED_KEY = 'unstream:muted'
const SHUFFLE_KEY = 'unstream:shuffle'
const REPEAT_KEY = 'unstream:repeat'

function stored<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = parse(raw)
    return parsed === null ? fallback : parsed
  } catch {
    return fallback
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A private window refuses; the setting just doesn't outlive the session.
  }
}

/** Fisher–Yates over indices, with `first` pulled to the front — shuffling
 *  from a track the person just picked has to keep playing that track. */
function shuffledOrder(length: number, first: number): number[] {
  const order = Array.from({ length }, (_, i) => i)
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const at = order.indexOf(first)
  if (at > 0) [order[0], order[at]] = [order[at], order[0]]
  return order
}

/** Full-track player for the on-disk library. One Audio element per session,
 *  like preview.ts — starting a track stops the previous one. Mounted in the
 *  desktop shell only; the web keeps previews. */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [shuffle, setShuffle] = useState(() => stored(SHUFFLE_KEY, (raw) => raw === '1', false))
  const [repeat, setRepeat] = useState<RepeatMode>(() =>
    stored<RepeatMode>(
      REPEAT_KEY,
      (raw) => (raw === 'all' || raw === 'one' || raw === 'off' ? raw : null),
      'off',
    ),
  )
  const [volume, setVolumeState] = useState(() =>
    stored(
      VOLUME_KEY,
      (raw) => {
        const n = Number(raw)
        return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
      },
      1,
    ),
  )
  const [muted, setMuted] = useState(() => stored(MUTED_KEY, (raw) => raw === '1', false))
  // Read by `playQueue` when it first builds the element. Keeping them out
  // of its dependency list is what stops a volume drag from rebuilding the
  // whole player context.
  const levelRef = useRef({ volume, muted })
  levelRef.current = { volume, muted }

  const queueRef = useRef(queue)
  queueRef.current = queue
  const indexRef = useRef(index)
  indexRef.current = index
  const repeatRef = useRef(repeat)
  repeatRef.current = repeat
  // Play order as indices into `queue`: identity when shuffle is off, a
  // permutation when it's on. Keeping the queue itself in listed order is
  // what lets the library view highlight the right row either way.
  const orderRef = useRef<number[]>([])

  const load = useCallback((at: number, autoplay: boolean) => {
    const q = queueRef.current
    if (at < 0 || at >= q.length) return
    const el = audioRef.current
    if (!el) return
    const item = q[at]
    indexRef.current = at
    setIndex(at)
    setTime(0)
    setFailed(false)
    setDuration(item.duration_ms > 0 ? item.duration_ms / 1000 : 0)
    if (autoplay) setLoading(true)
    el.src = item.url
    if (autoplay) void el.play().catch(() => setLoading(false))
  }, [])

  const loadRef = useRef(load)
  loadRef.current = load

  /** The next index in play order, or null at the end of a non-repeating
   *  queue. `manual` means a person pressed Next: repeat-one then means
   *  "again" only for the natural end of a track, never for a button. */
  const step = useCallback((delta: number, manual: boolean): number | null => {
    const q = queueRef.current
    if (q.length === 0) return null
    if (!manual && repeatRef.current === 'one') return indexRef.current
    const order = orderRef.current
    const pos = order.indexOf(indexRef.current)
    if (pos === -1) return null
    const at = pos + delta
    if (at < 0 || at >= order.length) {
      if (repeatRef.current === 'all') {
        return order[(at + order.length) % order.length]
      }
      return null
    }
    return order[at]
  }, [])

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current
    const el = new Audio()
    el.preload = 'metadata'
    el.addEventListener('timeupdate', () => setTime(el.currentTime))
    el.addEventListener('durationchange', () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration)
    })
    el.addEventListener('playing', () => {
      setPlaying(true)
      setLoading(false)
      setFailed(false)
    })
    el.addEventListener('pause', () => setPlaying(false))
    el.addEventListener('waiting', () => setLoading(true))
    el.addEventListener('error', () => {
      // A file deleted or renamed under us. Say so rather than looking
      // stuck, and don't march through the rest of the queue failing.
      setPlaying(false)
      setLoading(false)
      setFailed(true)
    })
    el.addEventListener('ended', () => {
      const at = step(1, false)
      if (at === null) {
        setPlaying(false)
        setTime(0)
        return
      }
      if (at === indexRef.current) {
        el.currentTime = 0
        void el.play().catch(() => {})
        return
      }
      loadRef.current(at, true)
    })
    audioRef.current = el
    return el
  }, [step])

  // Volume and mute live in React state and are pushed to the element, so a
  // slider, the mute button and a restored session all take the same path.
  useEffect(() => {
    const el = audioRef.current
    if (el) {
      el.volume = volume
      el.muted = muted
    }
    remember(VOLUME_KEY, String(volume))
    remember(MUTED_KEY, muted ? '1' : '0')
  }, [volume, muted])

  const playQueue = useCallback(
    (items: QueueItem[], startIndex: number) => {
      if (items.length === 0) return
      const at = Math.min(Math.max(0, startIndex), items.length - 1)
      const el = ensureAudio()
      el.volume = levelRef.current.volume
      el.muted = levelRef.current.muted
      queueRef.current = items
      setQueue(items)
      orderRef.current = shuffle
        ? shuffledOrder(items.length, at)
        : Array.from({ length: items.length }, (_, i) => i)
      load(at, true)
    },
    [ensureAudio, load, shuffle],
  )

  const playAt = useCallback(
    (at: number) => {
      ensureAudio()
      load(at, true)
    },
    [ensureAudio, load],
  )

  const toggle = useCallback(() => {
    const el = audioRef.current
    if (!el || queueRef.current.length === 0) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }, [])

  const next = useCallback(() => {
    const at = step(1, true)
    if (at !== null) load(at, true)
  }, [step, load])

  const prev = useCallback(() => {
    // A tap early in the song restarts it, like every music app; deeper in,
    // Prev means the previous track. The 3-second line is the convention.
    const el = audioRef.current
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      setTime(0)
      return
    }
    const at = step(-1, true)
    if (at !== null) load(at, true)
    else if (el) {
      el.currentTime = 0
      setTime(0)
    }
  }, [step, load])

  const seekTo = useCallback((seconds: number) => {
    const el = audioRef.current
    if (!el) return
    const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : seconds
    el.currentTime = Math.max(0, Math.min(limit, seconds))
    setTime(el.currentTime)
  }, [])

  const seekBy = useCallback(
    (delta: number) => seekTo((audioRef.current?.currentTime ?? 0) + delta),
    [seekTo],
  )

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value))
    setVolumeState(clamped)
    // Nudging the slider up off zero is an unmute, not a silent no-op.
    if (clamped > 0) setMuted(false)
  }, [])

  const toggleMute = useCallback(() => setMuted((m) => !m), [])

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      const nextOn = !on
      remember(SHUFFLE_KEY, nextOn ? '1' : '0')
      const q = queueRef.current
      orderRef.current = nextOn
        ? shuffledOrder(q.length, indexRef.current)
        : Array.from({ length: q.length }, (_, i) => i)
      return nextOn
    })
  }, [])

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => {
      const nextMode: RepeatMode = mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'
      remember(REPEAT_KEY, nextMode)
      return nextMode
    })
  }, [])

  const stop = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    queueRef.current = []
    indexRef.current = 0
    orderRef.current = []
    setQueue([])
    setIndex(0)
    setPlaying(false)
    setFailed(false)
    setTime(0)
    setDuration(0)
  }, [])

  const current = queue[index] ?? null

  // The OS now-playing panel and the keyboard's media keys. Without this the
  // play/pause key does nothing and macOS shows the browser's own name where
  // the song should be.
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    if (!current) {
      ms.metadata = null
      ms.playbackState = 'none'
      return
    }
    ms.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist || '',
      album: current.album || '',
      artwork: current.coverUrl
        ? [{ src: current.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    })
    ms.playbackState = playing ? 'playing' : 'paused'
  }, [current, playing])

  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => toggle()],
      ['pause', () => toggle()],
      ['previoustrack', () => prev()],
      ['nexttrack', () => next()],
      ['seekbackward', () => seekBy(-10)],
      ['seekforward', () => seekBy(10)],
      ['seekto', (details) => details.seekTime != null && seekTo(details.seekTime)],
      ['stop', () => stop()],
    ]
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // Older webviews don't know every action; the rest still bind.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null)
        } catch {
          // ignore
        }
      }
    }
  }, [toggle, prev, next, seekBy, seekTo, stop])

  // Pause on the way out so a closing window doesn't leave audio running
  // while the webview tears down.
  useEffect(() => () => audioRef.current?.pause(), [])

  const value = useMemo(
    () => ({
      queue,
      index,
      current,
      playing,
      loading,
      failed,
      shuffle,
      repeat,
      playQueue,
      playAt,
      toggle,
      next,
      prev,
      seekTo,
      seekBy,
      toggleShuffle,
      cycleRepeat,
      stop,
    }),
    [
      queue,
      index,
      current,
      playing,
      loading,
      failed,
      shuffle,
      repeat,
      playQueue,
      playAt,
      toggle,
      next,
      prev,
      seekTo,
      seekBy,
      toggleShuffle,
      cycleRepeat,
      stop,
    ],
  )

  const timeValue = useMemo(() => ({ time, duration }), [time, duration])
  const volumeValue = useMemo(
    () => ({ volume, muted, setVolume, toggleMute }),
    [volume, muted, setVolume, toggleMute],
  )

  return (
    <PlayerContext.Provider value={value}>
      <PlayerVolumeContext.Provider value={volumeValue}>
        <PlayerTimeContext.Provider value={timeValue}>{children}</PlayerTimeContext.Provider>
      </PlayerVolumeContext.Provider>
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}

/** Subscribe to the playhead alone. Anything that renders per tick — the
 *  scrubber, the clock, the lyric roll — reads here so the rest of the tree
 *  stays still. */
export function usePlayerTime(): PlayerTimeValue {
  return useContext(PlayerTimeContext)
}

/** Subscribe to volume alone, so the slider is the only thing a drag
 *  re-renders. */
export function usePlayerVolume(): PlayerVolumeValue {
  const ctx = useContext(PlayerVolumeContext)
  if (!ctx) throw new Error('usePlayerVolume must be used inside <PlayerProvider>')
  return ctx
}
