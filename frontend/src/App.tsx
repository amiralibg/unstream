import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AudioLines, Link2 as LinkIcon, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { isDesktop, notifyDownloadComplete, setWindowProgress } from './lib/desktop'
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
import { PlayerBar } from './components/PlayerBar'
import { PlayerProvider } from './lib/player'
import { DesktopSidebar, type DesktopTab } from './components/DesktopSidebar'

// The four desktop views and the palette are the largest components in the
// tree and none of them exists on the web. Splitting them keeps them out of
// the browser bundle entirely, and on the desktop they load from a local
// server the moment a tab is first opened — which is to say, instantly.
const DesktopCommandPalette = lazy(() =>
  import('./components/DesktopCommandPalette').then((m) => ({ default: m.DesktopCommandPalette })),
)
const DesktopLibraryView = lazy(() =>
  import('./components/DesktopLibraryView').then((m) => ({ default: m.DesktopLibraryView })),
)
const DesktopDownloadsView = lazy(() =>
  import('./components/DesktopDownloadsView').then((m) => ({ default: m.DesktopDownloadsView })),
)
const DesktopSettingsView = lazy(() =>
  import('./components/DesktopSettingsView').then((m) => ({ default: m.DesktopSettingsView })),
)
const KaraokeView = lazy(() =>
  import('./components/KaraokeView').then((m) => ({ default: m.KaraokeView })),
)
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

/** Toasts when a download job flips to finished, wherever the user is.
 *  On desktop it also drives the native dock/taskbar progress bar — the
 *  web shell's DownloadsDock does the same, but the desktop shell never
 *  mounts it, so this is where the desktop's progress lives. */
function DownloadNotifier() {
  const { entries } = useDownloads()
  const { push } = useToast()
  const m = useMessages()
  const finishedState = useRef<Map<string, boolean>>(new Map())

  useEffect(() => {
    if (!isDesktop()) return
    const active = entries.filter((e) => !(e.expired || (e.job?.finished ?? false)))
    if (active.length === 0) {
      void setWindowProgress(null)
      return
    }
    let settled = 0
    let total = 0
    for (const entry of entries) {
      const job = entry.job
      total += job?.total ?? entry.tracks.length
      if (job) {
        settled += job.done + job.failed
        for (const track of job.tracks) {
          if (track.status === 'downloading' || track.status === 'tagging') {
            settled += track.progress
          }
        }
      }
    }
    void setWindowProgress(total > 0 ? Math.min(1, settled / total) : 0)
  }, [entries])

  useEffect(() => {
    for (const entry of entries) {
      const finished = entry.job?.finished ?? false
      const was = finishedState.current.get(entry.jobId)
      if (finished && was === false) {
        const done = entry.job!.done
        const failed = entry.job!.failed
        if (entry.job!.cancelled > 0) {
          push(m.notify.cancelled(entry.name, done), 'info')
        } else if (done > 0 && failed === 0) {
          push(m.notify.ready(entry.name, done), 'success')
          if (isDesktop()) void notifyDownloadComplete(entry.name, m.notify.ready(entry.name, done))
        } else if (done > 0) {
          push(m.notify.partial(entry.name, done, failed), 'info')
          if (isDesktop())
            void notifyDownloadComplete(entry.name, m.notify.partial(entry.name, done, failed))
        } else {
          push(m.notify.failed(entry.name), 'error')
        }
      }
      finishedState.current.set(entry.jobId, finished)
    }
  }, [entries, push, m])

  return null
}

function DesktopIntegrations({ onUrl }: { onUrl: (url: string) => void }) {
  const onUrlRef = useRef(onUrl)
  onUrlRef.current = onUrl
  const { push } = useToast()
  const m = useMessages()
  const pushRef = useRef(push)
  pushRef.current = push
  const mRef = useRef(m)
  mRef.current = m

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
        pushRef.current(mRef.current.errors.noAnswer, 'error')
      }).then((fn) => {
        unlistenBackendErr = fn
      })
    })

    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      try {
        getCurrentWebview()
          .onDragDropEvent((event) => {
            if (event.payload.type === 'drop') {
              const paths = event.payload.paths
              for (const p of paths) {
                if (isCatalogUrl(p)) {
                  onUrlRef.current(p)
                  break
                }
              }
            }
          })
          .then((fn) => {
            unlistenDrop = fn
          })
      } catch {
        // ignore
      }
    })

    return () => {
      unlistenDeep?.()
      unlistenDrop?.()
      unlistenBackendErr?.()
    }
  }, [])

  return null
}

function OfflineBanner() {
  const [online, setOnline] = useState(() =>
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
  const [initialParams] = useState(() => new URLSearchParams(window.location.search))
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [desktopTab, setDesktopTab] = useState<DesktopTab>('search')

  const { push } = useToast()

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

  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)

  const [focusPulse, setFocusPulse] = useState(0)
  const [recent, setRecent] = useState(recentSearches)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [karaokeOpen, setKaraokeOpen] = useState(false)

  const m = useMessages()
  const desktopMode = isDesktop()
  const { Back, Forward, backNudge, forwardNudge } = useDirectional()

  const [sharedArrival, setSharedArrival] = useState<
    null | { kind: 'url' | 'artist' } | { kind: 'q'; query: string }
  >(null)

  const leaveSharedArrival = () => {
    setSharedArrival(null)
    setStack([])
    resetErrors()
  }

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
    setSharedArrival(null)
    setRecent(rememberSearch(input))
    if (desktopMode) setDesktopTab('search')

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
      openCollection(result.url, true)
    }
  }

  const goBack = useCallback(() => setStack((s) => s.slice(0, -1)), [])

  const openCollectionRef = useRef(openCollection)
  openCollectionRef.current = openCollection
  const stackRef = useRef(stack)
  stackRef.current = stack
  const goBackRef = useRef(goBack)
  goBackRef.current = goBack
  const pushRef = useRef(push)
  pushRef.current = push
  const busyRef = useRef(false)
  const mRef = useRef(m)
  mRef.current = m

  const loadMore = useCallback(async () => {
    const top = stackRef.current.at(-1)
    if (top?.type !== 'search' || !top.hasMore || loadingMoreRef.current) return

    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const next = await searchCatalog(top.query, top.page + 1)
      setStack((s) => {
        const current = s.at(-1)
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

  useEffect(() => {
    const focusSearch = (select = false) => {
      if (desktopMode) setDesktopTab('search')
      setFocusPulse((p) => p + 1)
      if (!inputRef.current) {
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
        if (desktopMode) setDesktopTab('search')
        pushRef.current(mRef.current.notify.linkDetected, 'info')
        openCollectionRef.current(text, false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        // Desktop gets the command palette — typing there searches directly,
        // so it replaces the focus-search shortcut. Web keeps the old path.
        if (desktopMode) {
          setPaletteOpen(true)
        } else {
          focusSearch(true)
        }
        return
      }
      if (e.key === 'Escape') {
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
  }, [cancelPending, desktopMode])

  const busy = resolve.isPending || search.isPending || artist.isPending
  busyRef.current = busy
  const error = [resolve.error, search.error, artist.error].find((e) => e && !isCanceled(e)) ?? null
  const view = stack.at(-1)
  const previous = stack.at(-2)
  const landing = stack.length === 0 && !busy && !error

  const goHome = () => {
    setStack([])
    setSharedArrival(null)
    resetErrors()
    if (desktopMode) setDesktopTab('search')
  }

  const viewKey = !view
    ? 'home'
    : view.type === 'collection'
      ? `collection:${view.url}`
      : view.type === 'artist'
        ? `artist:${view.artist.id}`
        : `search:${view.query}`

  const handleDesktopUrl = useCallback(
    (url: string) => {
      if (!isCatalogUrl(url)) return
      setSharedArrival(null)
      setRecent(rememberSearch(url))
      if (desktopMode) setDesktopTab('search')
      push(m.notify.linkDetected, 'info')
      openCollection(url, false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [push, m, desktopMode],
  )

  // ==========================================
  // DESKTOP APP SHELL (Sidebar + Views)
  // ==========================================
  if (desktopMode) {
    return (
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0a0c09] text-ink-100 select-none">
        <DesktopIntegrations onUrl={handleDesktopUrl} />
        <DesktopTitleBar />
        <OfflineBanner />

        <PlayerProvider>
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Native Desktop Sidebar */}
            <DesktopSidebar activeTab={desktopTab} onSelectTab={setDesktopTab} />

            <div className="flex-1 min-h-0 overflow-hidden">
              <Suspense fallback={<div className="h-full bg-[#10130f]" />}>
                {desktopTab === 'downloads' ? (
                  <DesktopDownloadsView onGoToSearch={() => setDesktopTab('search')} />
                ) : desktopTab === 'library' ? (
                  <DesktopLibraryView />
                ) : desktopTab === 'settings' ? (
                  <DesktopSettingsView />
                ) : (
                  <div className="flex h-full flex-col overflow-y-auto bg-[radial-gradient(circle_at_50%_-20%,rgba(200,242,79,0.045),transparent_34%)] px-7 pb-8 pt-5">
                    <main className="mx-auto w-full max-w-[62rem] flex-1">
                      {sharedArrival ? (
                        <section className="pt-6 pb-8">
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
                                className={clsx(
                                  'size-3.5 transition-transform duration-200',
                                  forwardNudge,
                                )}
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
                            landing ? 'pt-[8vh] pb-8' : 'pt-1 pb-4',
                          )}
                        >
                          <Collapsible open={landing}>
                            <div className="flex flex-col items-center text-center animate-fade-up mb-2">
                              <span className="grid size-12 place-items-center rounded-2xl bg-lime-flash text-lime-ink shadow-lg shadow-lime-flash/15">
                                <AudioLines className="size-6" strokeWidth={2.25} />
                              </span>
                              <p className="mt-3 text-sm font-medium text-ink-300">
                                {m.hero.appEmpty}
                              </p>
                            </div>
                          </Collapsible>

                          <UrlForm
                            className={clsx(
                              'animate-fade-up transition-[margin] duration-300 ease-out-expo shadow-[0_14px_45px_rgba(0,0,0,0.2)] [animation-delay:120ms]',
                              landing && 'mt-5',
                            )}
                            loading={busy}
                            onSubmit={handleSubmit}
                            onCancel={cancelPending}
                            inputRef={inputRef}
                            focusPulse={focusPulse}
                          />

                          <Collapsible open={landing}>
                            <div className="mt-4 flex justify-center">
                              <RecentSearches
                                items={recent}
                                onPick={handleSubmit}
                                onClear={() => setRecent(clearRecentSearches())}
                              />
                            </div>
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
                        <div key={viewKey} className="animate-fade-up pb-10">
                          {previous && (
                            <button
                              onClick={goBack}
                              className="group mb-3 flex items-center gap-1.5 rounded-ctl px-2.5 py-1.5 text-mini font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 active:scale-[0.98]"
                            >
                              <Back
                                className={clsx(
                                  'size-4 transition-transform duration-200',
                                  backNudge,
                                )}
                              />
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
                          {view.type === 'artist' && (
                            <ArtistView artist={view.artist} onPick={handlePick} />
                          )}
                          {view.type === 'collection' && (
                            <CollectionView
                              key={view.url}
                              url={view.url}
                              collection={view.collection}
                            />
                          )}
                        </div>
                      )}
                    </main>
                  </div>
                )}
              </Suspense>
            </div>
          </div>

          {paletteOpen && (
            <Suspense fallback={null}>
              <DesktopCommandPalette
                onClose={() => setPaletteOpen(false)}
                onSelectTab={(tab) => setDesktopTab(tab)}
                onSubmit={(input) => handleSubmit(input)}
                recent={recent}
              />
            </Suspense>
          )}
          <PlayerBar onExpand={() => setKaraokeOpen(true)} />
          {karaokeOpen && (
            <Suspense fallback={null}>
              <KaraokeView onClose={() => setKaraokeOpen(false)} />
            </Suspense>
          )}
          <DownloadNotifier />
        </PlayerProvider>
      </div>
    )
  }

  // ==========================================
  // WEB SITE / BROWSER SHELL (Unchanged)
  // ==========================================
  return (
    <div className="safe-x flex h-screen flex-col overflow-hidden bg-ink-950">
      <OfflineBanner />

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-between">
        <div>
          <header className="mx-auto flex w-full max-w-3xl items-center gap-2.5 px-5 pt-[calc(1.75rem+var(--safe-top))] select-none">
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
                  landing ? 'pt-10 pb-8 sm:pt-14 sm:pb-10' : 'pt-4 pb-3',
                )}
              >
                <YouTubeDisabledBanner />
                <Collapsible open={landing}>
                  <h1 className="animate-fade-up font-display text-[clamp(2.5rem,7.5vw,4.5rem)] leading-[1.15] font-bold text-balance">
                    {m.hero.titleLine1}
                    <br />
                    <span className="text-lime-flash">{m.hero.titleLine2}</span>
                  </h1>
                  <p className="mt-5 max-w-md animate-fade-up text-body leading-relaxed text-ink-300 [animation-delay:80ms]">
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
        </div>
      </div>

      <DownloadNotifier />
      <DownloadsDock />
    </div>
  )
}

export default function App() {
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
