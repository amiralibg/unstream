import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AudioLines, Link2 as LinkIcon, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { isDesktop, notifyDownloadComplete } from './lib/desktop'
import {
  apiError,
  getArtist,
  isCanceled,
  isCatalogUrl,
  mergeResults,
  resolveUrl,
  searchCatalog,
  type ArtistDetail,
  type Collection,
  type SearchResult,
} from './lib/api'
import { UrlForm } from './components/UrlForm'
import { CollectionView } from './components/CollectionView'
import { CollectionSkeleton } from './components/CollectionSkeleton'
import { SearchResults } from './components/SearchResults'
import { ArtistView } from './components/ArtistView'
import { DownloadsDock } from './components/DownloadsDock'
import { QualityPicker } from './components/QualityPicker'
import { LyricsToggle } from './components/LyricsToggle'
import { LanguagePicker } from './components/LanguagePicker'
import { SettingsSheet } from './components/SettingsSheet'
import { DesktopTitleBar } from './components/DesktopTitleBar'
import { SettingsIcon } from './components/icons'
import { RecentSearches } from './components/RecentSearches'
import { DownloadsProvider, useDownloads } from './lib/downloads'
import { LocaleProvider, useDirectional, useMessages } from './lib/i18n'
import type { Messages } from './lib/locales/en'
import { clearRecentSearches, recentSearches, rememberSearch } from './lib/recent'
import { ToastProvider, useToast } from './lib/toast'

/** What's on screen. A stack, so "back" walks search → artist → album. */
type View =
  | {
      type: 'search'
      query: string
      results: SearchResult[]
      /** Highest page fetched so far; infinite scroll asks for page + 1. */
      page: number
      hasMore: boolean
    }
  | { type: 'artist'; artist: ArtistDetail }
  | { type: 'collection'; url: string; collection: Collection }

/** What the back button says, named by the view it returns *to*. */
const backLabel = (type: View['type'], m: Messages): string =>
  type === 'search' ? m.nav.backToResults : type === 'artist' ? m.nav.backToArtist : m.nav.back

/** Animates its children to and from zero height. `grid-template-rows`
 *  1fr→0fr is the only way to transition to `height: auto`; the inner div does
 *  the clipping. `visibility` is in the transition list on purpose — it keeps
 *  collapsed copy out of the tab order and away from screen readers, but flips
 *  only at the end of the duration, so the content fades rather than vanishing
 *  the instant the collapse starts. */
function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'grid transition-[grid-template-rows] duration-300 ease-out-expo',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
      <div
        className={clsx(
          'overflow-hidden transition-[opacity,visibility] duration-300 ease-out-expo',
          open ? 'opacity-100' : 'invisible opacity-0',
        )}
      >
        {children}
      </div>
    </div>
  )
}

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Toasts when a download job flips to finished, wherever the user is. */
function DownloadNotifier() {
  const { entries } = useDownloads()
  const { push } = useToast()
  const m = useMessages()
  const finishedState = useRef<Map<string, boolean>>(new Map())

  useEffect(() => {
    for (const entry of entries) {
      const finished = entry.job?.finished ?? false
      // First sighting records, never announces: a restored job is first seen
      // already finished and must not be toasted twice. A job started here is
      // always first seen unfinished, so nothing is lost.
      const was = finishedState.current.get(entry.jobId)
      if (finished && was === false) {
        const done = entry.job!.done
        const failed = entry.job!.failed
        // Someone stopped this one. It is not an outcome to be told about in
        // the language of success or failure — they know, they asked.
        if (entry.job!.cancelled > 0) {
          push(m.notify.cancelled(entry.name, done), 'info')
        } else if (done > 0 && failed === 0) {
          push(m.notify.ready(entry.name, done), 'success')
          if (isDesktop()) void notifyDownloadComplete(entry.name, m.notify.ready(entry.name, done))
        } else if (done > 0) {
          push(m.notify.partial(entry.name, done, failed), 'info')
          if (isDesktop()) void notifyDownloadComplete(entry.name, m.notify.partial(entry.name, done, failed))
        } else {
          push(m.notify.failed(entry.name), 'error')
        }
      }
      finishedState.current.set(entry.jobId, finished)
    }
  }, [entries, push, m])

  return null
}

function DesktopIntegrations({
  onUrl,
}: {
  onUrl: (url: string) => void
}) {
  const onUrlRef = useRef(onUrl)
  onUrlRef.current = onUrl

  useEffect(() => {
    if (!isDesktop()) return
    let unlistenDeep: (() => void) | undefined
    let unlistenDrop: (() => void) | undefined
    let unlistenBackendErr: (() => void) | undefined

    void import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('deep-link', (e) => {
        const url = typeof e.payload === 'string' ? e.payload : ''
        if (url) onUrlRef.current(url)
      }).then((fn) => {
        unlistenDeep = fn
      })
      listen<string>('backend-error', (e) => {
        console.error('[Desktop] backend-error:', e.payload)
      }).then((fn) => {
        unlistenBackendErr = fn
      })
    })

    // File drop: Tauri emits tauri://drag-drop with paths
    void import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ paths: string[] }>('tauri://drag-drop', (e) => {
        const path = e.payload?.paths?.[0]
        // paths are file paths, not URLs — check if it's a URL string drop via webview
        if (path) {
          // ignore file drops; URL drops come via paste or deep-link
        }
      }).then((fn) => {
        unlistenDrop = fn
      })
    })

    // Also handle browser-native drop of URLs (more common than Tauri file drop)
    const onDrop = (ev: DragEvent) => {
      const url = ev.dataTransfer?.getData('text/plain')?.trim() ?? ''
      // Also check uri-list
      const uriList = ev.dataTransfer?.getData('text/uri-list')?.trim() ?? ''
      const candidate = url || uriList
      if (candidate && isCatalogUrl(candidate.split('\n')[0].trim())) {
        ev.preventDefault()
        onUrlRef.current(candidate.split('\n')[0].trim())
      }
    }
    const onDragOver = (ev: DragEvent) => {
      const hasUrl = !!ev.dataTransfer?.types.includes('text/plain')
      if (hasUrl) ev.preventDefault()
    }
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)

    return () => {
      unlistenDeep?.()
      unlistenDrop?.()
      unlistenBackendErr?.()
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [])

  return null
}

function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (online) return null
  return (
    <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-danger px-4 py-2 text-xs font-medium text-white">
      <span className="size-2 animate-pulse rounded-full bg-white" />
      Offline — downloads will resume when back online
    </div>
  )
}

function YouTubeDisabledBanner() {
  const m = useMessages()
  const [closed, setClosed] = useState(false)
  const isYouTubeDisabled =
    typeof window !== 'undefined' &&
    (window as unknown as { __UNSTREAM_CONFIG__?: { youtubeDisabled?: boolean } })
      .__UNSTREAM_CONFIG__?.youtubeDisabled === true
  const desktop = isDesktop()

  if (!isYouTubeDisabled || desktop || closed) return null

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-btn border border-lime-flash/30 bg-lime-flash/10 p-3.5 text-xs text-ink-100 animate-fade-up">
      <div className="flex items-center gap-2.5">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-lime-flash text-[11px] font-bold text-ink-950">
          !
        </span>
        <span className="leading-relaxed">{m.banner.youtubeDisabled}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ms-auto">
        <a
          href="https://github.com/amiralibg/unstream/releases"
          target="_blank"
          rel="noreferrer"
          className="rounded-ctl bg-lime-flash px-3 py-1 text-xs font-bold text-ink-950 transition hover:bg-lime-flash/90 active:scale-95"
        >
          {m.banner.getApp}
        </a>
        <button
          type="button"
          onClick={() => setClosed(true)}
          aria-label={m.settings.close}
          className="grid size-7 place-items-center rounded-ctl text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function Shell() {
  const [stack, setStack] = useState<View[]>([])
  // Deep link in the address bar (?url= / ?artist= / ?q=), captured before
  // any effect rewrites the query string.
  const [initialParams] = useState(() => new URLSearchParams(window.location.search))
  const inputRef = useRef<HTMLInputElement | null>(null)

  const { push } = useToast()

  // One controller for whatever the page is currently waiting on. A search
  // fans out to four providers for up to 20 seconds, and there is no way to
  // call that off server-side — so cancelling means dropping our end of it and
  // giving the person their page back, which is what they are asking for.
  // Starting anything new aborts the last one for the same reason.
  const pendingRef = useRef<AbortController | null>(null)
  const nextSignal = () => {
    pendingRef.current?.abort()
    const controller = new AbortController()
    pendingRef.current = controller
    return controller.signal
  }
  const cancelPending = useCallback(() => {
    pendingRef.current?.abort()
    pendingRef.current = null
  }, [])

  const resolve = useMutation({ mutationFn: (url: string) => resolveUrl(url, nextSignal()) })
  const search = useMutation({
    mutationFn: ({ query, page }: { query: string; page?: number }) =>
      searchCatalog(query, page, nextSignal()),
  })
  const artist = useMutation({ mutationFn: (id: string) => getArtist(id, nextSignal()) })

  // Infinite scroll: appended pages must not blank the results already on
  // screen, so they never go through the `search` mutation's pending state.
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)

  // Bumped whenever a shortcut focuses the search box, to flash the form.
  const [focusPulse, setFocusPulse] = useState(0)

  const [recent, setRecent] = useState(recentSearches)

  // The narrow layout's home for the header's preferences.
  const [settingsOpen, setSettingsOpen] = useState(false)

  const m = useMessages()
  const desktopMode = isDesktop()
  const { Back, Forward, backNudge, forwardNudge } = useDirectional()

  // Set when this page load came from a shared link. Landing straight in a
  // loading collection with the marketing hero above it reads as the app
  // searching on its own, so that arrival gets its own framing instead.
  const [sharedArrival, setSharedArrival] = useState<
    null | { kind: 'url' | 'artist' } | { kind: 'q'; query: string }
  >(null)

  const leaveSharedArrival = () => {
    setSharedArrival(null)
    setStack([])
    resetErrors()
  }

  // Shared mode hides the search form, so a shortcut pressed there has to
  // leave the mode first and focus once the form has actually mounted.
  const wantsFocusRef = useRef(false)
  useEffect(() => {
    if (sharedArrival || !wantsFocusRef.current) return
    wantsFocusRef.current = false
    inputRef.current?.focus()
  }, [sharedArrival])

  const resetErrors = () => {
    resolve.reset()
    search.reset()
    artist.reset()
  }

  const openCollection = (url: string, pushView: boolean) => {
    resolve.mutate(url, {
      onSuccess: (collection) => {
        const view: View = { type: 'collection', url, collection }
        setStack((s) => (pushView ? [...s, view] : [view]))
      },
    })
  }

  const handleSubmit = (input: string) => {
    resetErrors()
    setSharedArrival(null) // the user is driving now, not the link
    setRecent(rememberSearch(input))

    if (isCatalogUrl(input)) {
      openCollection(input, false)
    } else {
      search.mutate(
        { query: input },
        {
          onSuccess: (page) =>
            setStack([
              {
                type: 'search',
                query: input,
                results: page.results,
                page: page.page,
                hasMore: page.has_more,
              },
            ]),
        },
      )
    }
  }

  const handlePick = (result: SearchResult) => {
    resetErrors()
    if (result.kind === 'artist' && result.source === 'deezer') {
      artist.mutate(result.id, {
        onSuccess: (data) => setStack((s) => [...s, { type: 'artist', artist: data }]),
      })
    } else {
      // SoundCloud artists resolve their profile page — yt-dlp turns it
      // into a playlist of everything they've uploaded.
      openCollection(result.url, true)
    }
  }

  const goBack = useCallback(() => setStack((s) => s.slice(0, -1)), [])

  // Refs keep global listeners on a [] dep array without going stale.
  const openCollectionRef = useRef(openCollection)
  openCollectionRef.current = openCollection
  const stackRef = useRef(stack)
  stackRef.current = stack
  const goBackRef = useRef(goBack)
  goBackRef.current = goBack
  const pushRef = useRef(push)
  pushRef.current = push
  // Assigned below, once the mutations have been asked; the shortcut handler
  // only reads it when a key is actually pressed.
  const busyRef = useRef(false)
  // Same reason as `push`: the global paste/update listeners are mounted once,
  // but must announce in whatever language is current when they fire.
  const mRef = useRef(m)
  mRef.current = m

  /** Fetch the next page and append it to the search view on top of the stack. */
  const loadMore = useCallback(async () => {
    const top = stackRef.current.at(-1)
    if (top?.type !== 'search' || !top.hasMore || loadingMoreRef.current) return

    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const next = await searchCatalog(top.query, top.page + 1)
      setStack((s) => {
        const current = s.at(-1)
        // The user navigated (or searched again) mid-flight — drop the page.
        if (current?.type !== 'search' || current.query !== top.query) return s
        return [
          ...s.slice(0, -1),
          {
            ...current,
            results: mergeResults(current.results, next.results),
            page: next.page,
            hasMore: next.has_more,
          },
        ]
      })
    } catch (err) {
      pushRef.current(apiError(err, mRef.current), 'error')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [])

  // Deep link restore: ?url=… / ?artist=… / ?q=…
  const bootstrapped = useRef(false)
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    const url = initialParams.get('url')
    const artistId = initialParams.get('artist')
    const q = initialParams.get('q')
    if (url && isCatalogUrl(url)) {
      setSharedArrival({ kind: 'url' })
      openCollection(url, false)
    } else if (artistId) {
      setSharedArrival({ kind: 'artist' })
      artist.mutate(artistId, {
        onSuccess: (data) => setStack([{ type: 'artist', artist: data }]),
      })
    } else if (q) {
      setSharedArrival({ kind: 'q', query: q })
      search.mutate(
        { query: q },
        {
          onSuccess: (page) =>
            setStack([
              {
                type: 'search',
                query: q,
                results: page.results,
                page: page.page,
                hasMore: page.has_more,
              },
            ]),
        },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the address bar shareable: it always mirrors the top view.
  useEffect(() => {
    const view = stack.at(-1)
    const params = new URLSearchParams()
    if (view?.type === 'collection') params.set('url', view.url)
    else if (view?.type === 'artist') params.set('artist', view.artist.id)
    else if (view?.type === 'search') params.set('q', view.query)
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }, [stack])

  // A new release's service worker took over — offer a reload. (Hidden tabs
  // already reload themselves; see main.tsx.)
  useEffect(() => {
    const onUpdate = () =>
      pushRef.current(mRef.current.notify.newVersion, 'info', {
        label: mRef.current.notify.refresh,
        onClick: () => window.location.reload(),
      })
    window.addEventListener('unstream:update', onUpdate)
    return () => window.removeEventListener('unstream:update', onUpdate)
  }, [])

  // Smart paste + keyboard shortcuts.
  useEffect(() => {
    // Focus alone is easy to miss — pulse the form so the shortcut lands.
    const focusSearch = (select: boolean) => {
      setFocusPulse((n) => n + 1)
      if (!inputRef.current) {
        // Shared-link mode: swap in the search UI, then focus (see effect).
        wantsFocusRef.current = true
        setSharedArrival(null)
        return
      }
      inputRef.current.focus()
      if (select) inputRef.current.select()
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
      const text = e.clipboardData?.getData('text')?.trim()
      if (text && isCatalogUrl(text)) {
        e.preventDefault()
        setSharedArrival(null)
        setRecent(rememberSearch(text))
        pushRef.current(mRef.current.notify.linkDetected, 'info')
        openCollectionRef.current(text, false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        focusSearch(true)
        return
      }
      if (e.key === 'Escape') {
        // Ahead of the blur, and of going back: with a request in flight, the
        // thing on screen the user wants stopped is the request. The search box
        // still holds focus from the Enter that started it, so checking for a
        // typing target first would spend the key on a blur every time.
        if (busyRef.current) {
          cancelPending()
          return
        }
        if (isTypingTarget(e.target)) {
          ;(e.target as HTMLElement).blur()
          return
        }
        goBackRef.current()
        return
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        focusSearch(false)
      }
    }
    document.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [cancelPending])

  const busy = resolve.isPending || search.isPending || artist.isPending
  busyRef.current = busy
  // An aborted request lands in a mutation's error slot like any other
  // rejection. Filtered rather than reset, because the abort and the rejection
  // are not in the same tick — resetting on the click would be undone by the
  // error arriving after it.
  const error = [resolve.error, search.error, artist.error].find((e) => e && !isCanceled(e)) ?? null
  const view = stack.at(-1)
  const previous = stack.at(-2)
  // Nothing asked for yet: the only time the hero earns its screen space.
  // `busy` counts as landed — the skeleton is already below, and holding the
  // hero up through the first search then dropping it reads as a jump. An
  // error counts too: re-expanding would push the message the user needs to
  // read down below a screen of copy they don't.
  const landing = stack.length === 0 && !busy && !error

  const goHome = () => {
    setStack([])
    setSharedArrival(null)
    resetErrors()
  }

  const viewKey = !view
    ? 'home'
    : view.type === 'collection'
      ? `collection:${view.url}`
      : view.type === 'artist'
        ? `artist:${view.artist.id}`
        : `search:${view.query}`

  // Desktop deep-link handler needs to be in Shell to access openCollection/handleSubmit
  const handleDesktopUrl = useCallback(
    (url: string) => {
      if (!isCatalogUrl(url)) return
      setSharedArrival(null)
      setRecent(rememberSearch(url))
      push(m.notify.linkDetected, 'info')
      openCollection(url, false)
    },
    [push, m],
  )

  return (
    <div className={clsx('safe-x flex h-screen flex-col overflow-hidden', desktopMode ? 'bg-[#0a0a0a]' : 'bg-ink-950')}>
      <DesktopIntegrations onUrl={handleDesktopUrl} />
      <DesktopTitleBar onOpenSettings={() => setSettingsOpen(true)} />
      <OfflineBanner />

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-between">
        <div>
          <header
            className={clsx(
              'mx-auto flex w-full max-w-3xl items-center gap-2.5 px-5 select-none',
              desktopMode ? 'pt-2.5 pb-2' : 'pt-[calc(1.75rem+var(--safe-top))]',
            )}
          >
        {/* With the hero collapsed, the wordmark is the only way back to it —
            and the first thing anyone tries. */}
        <button
          onClick={goHome}
          disabled={landing}
          aria-label={m.app.home}
          className="group flex items-center gap-2.5 rounded-ctl transition disabled:cursor-default"
        >
          <span className="grid size-8 place-items-center rounded-ctl bg-lime-flash text-lime-ink transition duration-200 group-enabled:group-active:scale-95">
            <AudioLines className="size-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-display text-lg font-semibold transition-colors duration-200 group-enabled:group-hover:text-lime-flash">
            {m.app.name}
          </span>
        </button>
        {/* Preferences, so they share the trailing edge; the two that change
            what a download *is* come first. Below `sm` they move into a sheet:
            three chip strips do not fit beside the wordmark, and a flex row
            will not shrink below its content, so leaving them here gave the
            document a horizontal scrollbar. */}
        <div className="ms-auto hidden items-center gap-2.5 sm:flex">
          <LyricsToggle />
          <QualityPicker />
          <LanguagePicker />
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label={m.settings.open}
          aria-haspopup="dialog"
          className="tap-target ms-auto grid size-9 shrink-0 place-items-center rounded-ctl border border-ink-800 bg-ink-900 text-ink-300 transition duration-200 hover:text-ink-100 active:scale-90 sm:hidden"
        >
          <SettingsIcon className="size-5" />
        </button>
      </header>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-24">
        {sharedArrival ? (
          <section className="pt-10 pb-8">
            <div className="animate-fade-up rounded-panel border border-lime-flash/25 bg-lime-flash/[0.06] p-4 sm:p-5">
              <p className="flex items-center gap-2 text-micro font-semibold text-lime-flash">
                <LinkIcon className="size-3.5" />
                {m.shared.badge}
              </p>
              <h1 className="mt-2 font-display text-2xl font-bold text-balance">
                {error
                  ? m.shared.titleError
                  : sharedArrival.kind === 'q'
                    ? m.shared.titleQuery
                    : busy
                      ? m.shared.titleBusy
                      : m.shared.titleDefault}
              </h1>
              <p className="mt-2 text-mini text-ink-300">
                {error ? (
                  m.shared.bodyError
                ) : sharedArrival.kind === 'q' ? (
                  <>
                    {m.shared.queryBefore}{' '}
                    <span className="text-lime-flash" dir="auto">
                      {m.app.quote(sharedArrival.query)}
                    </span>{' '}
                    {m.shared.queryAfter}
                  </>
                ) : (
                  m.shared.bodyDefault
                )}
              </p>
              <button
                onClick={leaveSharedArrival}
                className="group mt-4 flex items-center gap-1.5 rounded-btn border border-ink-600 px-3.5 py-2 text-mini font-medium text-ink-100 transition duration-200 hover:border-ink-400 active:scale-[0.98]"
              >
                <Search className="size-3.5" />
                {m.shared.searchElse}
                <Forward
                  className={clsx('size-3.5 transition-transform duration-200', forwardNudge)}
                />
              </button>
            </div>
            {error && (
              <p
                role="alert"
                className="mt-4 animate-fade-up rounded-btn border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                {apiError(error, m)}
              </p>
            )}
          </section>
        ) : (
          <section
            className={clsx(
              'transition-[padding] duration-300 ease-out-expo',
              landing
                ? desktopMode
                  ? 'pt-6 pb-3'
                  : 'pt-10 pb-8 sm:pt-14 sm:pb-10'
                : 'pt-4 pb-3',
            )}
          >
            <YouTubeDisabledBanner />
            {/* grid-rows 1fr→0fr is the one way to transition to height:auto;
                the inner wrapper does the clipping. */}
            <Collapsible open={landing}>
              <h1
                className={clsx(
                  'animate-fade-up font-display font-bold text-balance leading-[1.15]',
                  desktopMode ? 'text-[clamp(2rem,4vw,3rem)]' : 'text-[clamp(2.5rem,7.5vw,4.5rem)]',
                )}
              >
                {m.hero.titleLine1}
                <br />
                <span className="text-lime-flash">{m.hero.titleLine2}</span>
              </h1>
              <p
                className={clsx(
                  'max-w-md animate-fade-up leading-relaxed text-ink-300 [animation-delay:80ms]',
                  desktopMode ? 'mt-3 text-sm' : 'mt-5 text-body',
                )}
              >
                {m.hero.blurb}
              </p>
            </Collapsible>

            <UrlForm
              className={clsx(
                'animate-fade-up transition-[margin] duration-300 ease-out-expo [animation-delay:160ms]',
                landing && 'mt-8',
              )}
              loading={busy}
              onSubmit={handleSubmit}
              onCancel={cancelPending}
              inputRef={inputRef}
              focusPulse={focusPulse}
            />

            {/* The shortcut hint is a discovery aid and the chips are a
                cold-start affordance — both belong to the empty page only. */}
            <Collapsible open={landing}>
              <p className="mt-3 pb-1 animate-fade-up text-mini text-ink-400 [animation-delay:220ms]">
                {m.hero.shortcutBefore}{' '}
                <kbd className="rounded-[5px] border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-sans text-micro text-ink-300">
                  /
                </kbd>{' '}
                {m.hero.shortcutAfter}
              </p>
              <RecentSearches
                items={recent}
                onPick={handleSubmit}
                onClear={() => setRecent(clearRecentSearches())}
              />
            </Collapsible>

            {error && (
              <p
                role="alert"
                className="mt-4 animate-fade-up rounded-btn border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger"
              >
                {apiError(error, m)}
              </p>
            )}
          </section>
        )}

        {busy && <CollectionSkeleton />}
        {!busy && view && (
          <div key={viewKey} className="animate-fade-up">
            {previous && (
              <button
                onClick={goBack}
                className="group mb-3 flex items-center gap-1.5 rounded-ctl px-2 py-1.5 text-mini font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 active:scale-[0.98]"
              >
                <Back className={clsx('size-4 transition-transform duration-200', backNudge)} />
                {backLabel(previous.type, m)}
              </button>
            )}
            {view.type === 'search' && (
              <SearchResults
                query={view.query}
                results={view.results}
                hasMore={view.hasMore}
                loadingMore={loadingMore}
                onLoadMore={loadMore}
                onPick={handlePick}
              />
            )}
            {view.type === 'artist' && <ArtistView artist={view.artist} onPick={handlePick} />}
            {view.type === 'collection' && (
              <CollectionView key={view.url} url={view.url} collection={view.collection} />
            )}
          </div>
        )}
      </main>

      {!desktopMode && (
        <footer className="mx-auto w-full max-w-3xl px-5 py-4 shrink-0">
          <div
            dir="ltr"
            className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-sm text-ink-400"
          >
            <span>Built by</span>
            <a
              href="https://x.com/_amiralibgi"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-medium text-ink-300 underline decoration-ink-600 underline-offset-2 transition hover:text-lime-flash hover:decoration-lime-flash/60"
            >
              <img
                src="/amirali.jpg"
                alt=""
                loading="lazy"
                className="size-5 rounded-full object-cover"
              />
              amiralibgi
            </a>
            <span>and</span>
            <a
              href="https://x.com/yazdanctx"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-medium text-ink-300 underline decoration-ink-600 underline-offset-2 transition hover:text-lime-flash hover:decoration-lime-flash/60"
            >
              <img
                src="/yazdan.jpg"
                alt=""
                loading="lazy"
                className="size-5 rounded-full object-cover"
              />
              yazdanctx
            </a>
          </div>
        </footer>
      )}
      </div>
      </div>

      <DownloadNotifier />
      <DownloadsDock />
    </div>
  )
}

export default function App() {
  // Locale outermost: the toasts and the download dock both render copy, so
  // there is no part of the tree that can be built before the language is known.
  return (
    <LocaleProvider>
      <ToastProvider>
        <DownloadsProvider>
          <Shell />
        </DownloadsProvider>
      </ToastProvider>
    </LocaleProvider>
  )
}
