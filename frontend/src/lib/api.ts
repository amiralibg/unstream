import axios from 'axios'
import type { Messages } from './locales/en'

export interface Track {
  id: string
  title: string
  artists: string[]
  album: string
  duration_ms: number
  cover_url: string | null
  track_number: number
  release_date: string
  preview_url: string | null
  source_url: string | null
  /** Lyrics preview attached by the backend if known. */
  lyrics?: string | null
}

export interface Collection {
  kind: 'track' | 'album' | 'playlist'
  name: string
  owner: string
  cover_url: string | null
  tracks: Track[]
}

export type FailureKind =
  'bot_check' | 'network' | 'tls' | 'cookies' | 'encoding' | 'not_found' | 'other'

/** Failures a setting can fix: the connection, or the browser cookies. */
export const FIXABLE_IN_SETTINGS: ReadonlySet<FailureKind> = new Set([
  'bot_check',
  'network',
  'tls',
  'cookies',
])

/** The failure most of a job's broken tracks share — one explanation per
 *  album, not one per row. */
export function commonFailure(tracks: JobTrack[]): FailureKind | null {
  const counts = new Map<FailureKind, number>()
  for (const track of tracks) {
    if (track.status !== 'error') continue
    const kind = track.error_kind ?? 'other'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  let best: FailureKind | null = null
  for (const [kind, n] of counts) if (best === null || n > counts.get(best)!) best = kind
  return best
}

export type TrackStatus =
  'queued' | 'searching' | 'downloading' | 'tagging' | 'retrying' | 'done' | 'error' | 'cancelled'

export interface JobTrack {
  id: string
  status: TrackStatus
  progress: number
  error: string | null
  /** What kind of failure `error` is — mirrors `error_kind()` in
   *  backend/app/net.py. The UI words it; `error` stays the raw record. */
  error_kind?: FailureKind | null
  /** Format the finished file actually came out as ('mp3' | 'm4a' | 'opus'). */
  ext?: string | null
  path?: string
}

export interface Job {
  id: string
  name: string
  quality: Quality
  dir: string | null
  tracks: JobTrack[]
  done: number
  failed: number
  /** Tracks stopped by a cancel. Counts toward `finished` without counting as
   *  a failure, so a cancelled job is not reported as a broken one. */
  cancelled: number
  total: number
  finished: boolean
}

/** Audio the user can ask for: an mp3 bitrate in kbps, or the upload's own
 *  stream untouched. Mirrors QUALITIES in backend/app/downloader.py. */
export const QUALITIES = ['128', '192', '320', 'original'] as const

export type Quality = (typeof QUALITIES)[number]

export const DEFAULT_QUALITY: Quality = '192'

/** "original" is a word and comes from the dictionary; the bitrates are a
 *  quantity the UI is stating, so they get the locale's digits. (File
 *  extensions — mp3, m4a, opus — are names, not quantities, and stay as they
 *  came.) */
export const qualityLabel = (quality: Quality, m: Messages): string =>
  quality === 'original' ? m.quality.original : m.app.num(quality)

export const isQuality = (value: unknown): value is Quality => QUALITIES.includes(value as Quality)

export type Source = 'deezer' | 'itunes' | 'youtube' | 'soundcloud'

export type ResultKind = 'track' | 'album' | 'artist' | 'playlist'

export interface SearchResult {
  kind: ResultKind
  id: string
  name: string
  subtitle: string
  cover_url: string | null
  url: string
  source: Source
  /** Server-computed identity (kind + name + artist). The backend dedupes
   *  within a page; the client reuses this key to dedupe across pages. */
  dedup_key: string
}

export interface SearchPage {
  results: SearchResult[]
  page: number
  has_more: boolean
}

export interface ArtistDetail {
  id: string
  name: string
  picture_url: string | null
  fan_count: number | null
  top_tracks: SearchResult[]
  albums: SearchResult[]
}

/** Lyrics for a track. `synced` (time-stamped LRC) is fetched and cached but
 *  not rendered in v1 — it's a future karaoke view waiting for a client.
 *
 *  `status` says which kind of nothing a null `plain` is. `absent` means every
 *  source answered and none has this song; `unavailable` means they could not
 *  be reached. Rendering those the same way is what let a blocked source read
 *  as "this song has no lyrics" — only one of the two is worth a retry. */
export interface Lyrics {
  status: 'found' | 'absent' | 'unavailable'
  plain: string | null
  synced: string | null
  source: string | null
}

const client = axios.create({ baseURL: '/api' })

/** A search or link that failed because nothing could be reached, as opposed
 *  to one that was reached and said no. */
const UNREACHABLE =
  /^Search failed|^Could not reach|timed out|Unable to download (?:webpage|API page)|getaddrinfo|Name or service not known|nodename nor servname|Connection (?:refused|reset|aborted)|Network is unreachable|CERTIFICATE_VERIFY_FAILED|Tunnel connection failed|Remote end closed|HTTP Error 401/

/** True when a request failed for want of a connection to the services — the
 *  case a VPN or proxy setting can fix, so the UI offers a way there. */
export function isConnectionError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  if (err.response?.status == null) return false
  const detail = err.response.data?.detail
  return typeof detail === 'string' && UNREACHABLE.test(detail)
}

/** Backend `detail` strings, matched to a dictionary entry. The wire carries a
 *  terse machine-facing message; each surface renders it in its own voice and
 *  its own language (docs/DESIGN.md). The capture group, when there is one,
 *  carries the backend's number through to the phrase. */
const ERROR_PHRASES: [RegExp, (m: Messages, n: string) => string][] = [
  [/^Too many searches — wait (\d+)s/, (m, n) => m.errors.tooManySearches(n)],
  [/^Too many links opened — wait (\d+)s/, (m, n) => m.errors.tooManyLinks(n)],
  [/^Too many downloads started — wait (\d+)s/, (m, n) => m.errors.tooManyDownloads(n)],
  [/^Too many downloads at once/, (m) => m.errors.downloadsAtOnce],
  [/^Too many tracks — (\d+)/, (m, n) => m.errors.tooManyTracks(n)],
  [/^Unsupported link/, (m) => m.errors.unsupportedLink],
  [/^No tracks to download/, (m) => m.errors.noTracksSelected],
  [/^No completed tracks yet/, (m) => m.errors.nothingFinished],
  [/^Track not ready/, (m) => m.errors.notReady],
  [/^Unknown job/, (m) => m.errors.unknownJob],
  [/^Empty search query/, (m) => m.errors.emptyQuery],
  [/^A playlist needs a name/, (m) => m.errors.playlistName],
  [/^Unknown playlist/, (m) => m.errors.unknownPlaylist],
  [/^Not a playlist file/, (m) => m.errors.playlistUnreadable],
  [/^This playlist was exported by a newer/, (m) => m.errors.playlistNewer],
  [/^That playlist has no songs/, (m) => m.errors.playlistEmpty],
  [/^That file is too large to be a playlist/, (m) => m.errors.playlistTooLarge],
  [/^Everything is already downloaded/, (m) => m.errors.alreadyDownloaded],
  [/^Could not find this song to play/, (m) => m.errors.streamMissing],
  // Last, and not anchored: provider errors wrap the socket's own words.
  [UNREACHABLE, (m) => m.errors.unreachable],
]

/** For anything the table missed: provider and yt-dlp errors are raw internals,
 *  which have no place in the UI in any language. */
function statusFallback(status: number, m: Messages): string {
  if (status === 400) return m.errors.badRequest
  if (status === 404) return m.errors.notFound
  if (status === 429) return m.errors.rateLimited
  return m.errors.noAnswer
}

/** Turns a thrown request into a sentence. Takes the dictionary rather than
 *  reaching for one, so it stays callable outside a React tree. */
export function apiError(err: unknown, m: Messages): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status
    const detail = err.response?.data?.detail
    if (status == null) return m.errors.offline
    const text = typeof detail === 'string' ? detail : ''
    for (const [pattern, phrase] of ERROR_PHRASES) {
      // Patterns anchor on the opening and the phrase covers the whole
      // message, so no raw backend tail hangs off the end of a sentence.
      const match = pattern.exec(text)
      if (match) return phrase(m, match[1] ?? '')
    }
    return statusFallback(status, m)
  }
  return err instanceof Error ? err.message : m.errors.unknown
}

const URL_PATTERNS = [
  /open\.spotify\.com\/(intl-[a-zA-Z-]+\/)?(track|album|playlist)\//,
  /deezer\.com\/([a-z]{2}\/)?(track|album|playlist)\/\d+/,
  /music\.apple\.com\/([a-z]{2}\/)?(album|song)\//,
  /(music\.|www\.|m\.)?(youtube\.com\/(watch|playlist|shorts)|youtu\.be\/)/,
  /(www\.|m\.|on\.)?soundcloud\.com\/./,
]

export const isCatalogUrl = (input: string) => URL_PATTERNS.some((re) => re.test(input))

/** True when a request ended because we aborted it, not because it failed.
 *  Everything that takes a `signal` below can end this way, and a cancelled
 *  request has no error to report — the user is the one who stopped it. */
export const isCanceled = (err: unknown): boolean => axios.isCancel(err)

export async function searchCatalog(
  query: string,
  page = 0,
  signal?: AbortSignal,
): Promise<SearchPage> {
  const { data } = await client.get<SearchPage>('/search', {
    params: { q: query, page },
    signal,
  })
  return data
}

/** Append a page, dropping anything already on screen. */
export function mergeResults(current: SearchResult[], incoming: SearchResult[]): SearchResult[] {
  const seen = new Set(current.map((r) => r.dedup_key))
  const fresh: SearchResult[] = []
  for (const result of incoming) {
    if (seen.has(result.dedup_key)) continue
    seen.add(result.dedup_key)
    fresh.push(result)
  }
  return fresh.length > 0 ? [...current, ...fresh] : current
}

export async function getArtist(id: string, signal?: AbortSignal): Promise<ArtistDetail> {
  const { data } = await client.get<ArtistDetail>(`/artist/${id}`, { signal })
  return data
}

export async function resolveUrl(url: string, signal?: AbortSignal): Promise<Collection> {
  const { data } = await client.post<Collection>('/resolve', { url }, { signal })
  return data
}

export async function startDownload(
  url: string,
  trackIds?: string[],
  quality: Quality = DEFAULT_QUALITY,
  lyrics: boolean = true,
): Promise<string> {
  const { data } = await client.post<{ job_id: string }>('/download', {
    url,
    track_ids: trackIds ?? null,
    quality,
    lyrics,
  })
  return data.job_id
}

/** Lyrics for a track, keyed by its catalog metadata. Always 200: nulls mean
 *  "no lyrics", and the UI renders that as its own state rather than an error.
 *
 *  `refresh` is for the retry button. The backend caches an outage for a few
 *  minutes so an album download doesn't re-pay the lookup on every track, and
 *  this is the flag that says "a person asked, go and look again anyway". */
export async function getLyrics(track: Track, refresh = false): Promise<Lyrics> {
  const { data } = await client.get<Lyrics>('/lyrics', {
    params: {
      artist: track.artists.join(', '),
      title: track.title,
      album: track.album,
      duration_ms: track.duration_ms,
      ...(refresh ? { refresh: 1 } : {}),
    },
  })
  return data
}

export async function getJob(jobId: string): Promise<Job> {
  const { data } = await client.get<Job>(`/jobs/${jobId}`)
  return data
}

/** Poll every unfinished job in one request. Jobs the server no longer knows
 *  are absent from the response — callers use that gap to retire them. */
export async function getJobs(jobIds: string[]): Promise<Job[]> {
  if (jobIds.length === 0) return []
  const { data } = await client.get<{ jobs: Job[] }>('/jobs', {
    params: { ids: jobIds.join(',') },
  })
  return data.jobs
}

/** Stop a running job. Answers with the job's new state — every unfinished
 *  track already `cancelled` — so the dock doesn't have to wait for the next
 *  poll to stop claiming the download is still going. */
export async function cancelJob(jobId: string): Promise<Job> {
  const { data } = await client.post<Job>(`/jobs/${jobId}/cancel`)
  return data
}

export async function retryJob(jobId: string): Promise<Job> {
  const { data } = await client.post<Job>(`/jobs/${jobId}/retry`)
  return data
}

export async function retryTrack(jobId: string, trackId: string): Promise<Job> {
  const { data } = await client.post<Job>(`/jobs/${jobId}/tracks/${trackId}/retry`)
  return data
}

export const trackFileUrl = (jobId: string, trackId: string) =>
  `/api/jobs/${jobId}/tracks/${trackId}/file`

export const jobZipUrl = (jobId: string) => `/api/jobs/${jobId}/zip`

/** One playable file from the on-disk library. Tags come from the file
 *  itself; anything the tags don't name arrives empty and the UI falls
 *  back to the filename-derived title. */
export interface LibraryTrack {
  id: string
  title: string
  artist: string
  album: string
  duration_ms: number
  size: number
  mtime: number
  has_lyrics: boolean
  has_cover: boolean
}

export async function getLibrary(): Promise<LibraryTrack[]> {
  const { data } = await client.get<{ root: string; tracks: LibraryTrack[] }>('/library')
  return data.tracks
}

export const libraryFileUrl = (fileId: string) => `/api/library/file/${fileId}`

/** Embedded cover art. Served with an ETag, so the browser revalidates
 *  instead of re-decoding; a track with no art answers 404 and the caller
 *  shows its own glyph. */
export const libraryCoverUrl = (fileId: string) => `/api/library/cover/${fileId}`

/** Lyrics already on the machine — the sidecar `.lrc` written at download
 *  time, or the embedded frame. Null when the track carries neither, which
 *  is the caller's cue to try the online lookup. */
export async function getLibraryLyrics(fileId: string): Promise<Lyrics | null> {
  try {
    const { data } = await client.get<{ plain: string; synced: string; source: string }>(
      `/library/lyrics/${fileId}`,
    )
    // A backend older than this frontend has no such route, and the SPA
    // fallback used to answer it with index.html — which parses into an
    // object with no `plain` and reads as "this song has no lyrics".
    // Anything that isn't recognisably lyrics means go to the network.
    if (typeof data !== 'object' || data === null) return null
    const plain = typeof data.plain === 'string' ? data.plain : ''
    const synced = typeof data.synced === 'string' ? data.synced : ''
    if (!plain && !synced) return null
    return { status: 'found', plain: plain || null, synced: synced || null, source: 'file' }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null
    throw err
  }
}

/** A song as a playlist keeps it: catalog metadata that means the same thing
 *  on any machine, plus — per read — whether this machine has it on disk.
 *  `file_id` is null for a song that would have to stream or download. */
export interface PlaylistTrack {
  uid: string
  title: string
  artists: string[]
  album: string
  duration_ms: number
  cover_url: string | null
  source_url: string | null
  file_id: string | null
  /** What to show as art: the catalog's cover, else the file's own. */
  cover: string | null
}

export interface PlaylistSummary {
  id: string
  name: string
  created_at: number
  updated_at: number
  count: number
  on_disk: number
  duration_ms: number
  covers: string[]
}

export interface Playlist {
  id: string
  name: string
  created_at: number
  updated_at: number
  tracks: PlaylistTrack[]
}

/** What the UI hands over when it adds a song: catalog metadata from a
 *  search, an album or a stream — or a library file id for a song that only
 *  exists on disk. */
export interface PlaylistTrackInput {
  title: string
  artists: string[]
  album?: string
  duration_ms?: number
  cover_url?: string | null
  source_url?: string | null
  file_id?: string | null
}

export const trackInput = (track: Track): PlaylistTrackInput => ({
  title: track.title,
  artists: track.artists,
  album: track.album,
  duration_ms: track.duration_ms,
  cover_url: track.cover_url,
  source_url: track.source_url,
})

export const libraryInput = (track: LibraryTrack): PlaylistTrackInput => ({
  title: track.title,
  artists: track.artist ? [track.artist] : [],
  album: track.album,
  duration_ms: track.duration_ms,
  file_id: track.id,
})

export async function getPlaylists(): Promise<PlaylistSummary[]> {
  const { data } = await client.get<{ playlists: PlaylistSummary[] }>('/playlists')
  return data.playlists
}

export async function getPlaylist(id: string): Promise<Playlist> {
  const { data } = await client.get<Playlist>(`/playlists/${id}`)
  return data
}

export async function createPlaylist(
  name: string,
  tracks: PlaylistTrackInput[] = [],
): Promise<Playlist> {
  const { data } = await client.post<Playlist>('/playlists', { name, tracks })
  return data
}

export async function updatePlaylist(
  id: string,
  changes: { name?: string; order?: string[] },
): Promise<Playlist> {
  const { data } = await client.patch<Playlist>(`/playlists/${id}`, changes)
  return data
}

export async function deletePlaylist(id: string): Promise<void> {
  await client.delete(`/playlists/${id}`)
}

export async function addToPlaylist(
  id: string,
  tracks: PlaylistTrackInput[],
): Promise<{ playlist: Playlist; added: number; skipped: number }> {
  const { data } = await client.post<{ playlist: Playlist; added: number; skipped: number }>(
    `/playlists/${id}/tracks`,
    { tracks },
  )
  return data
}

export async function removeFromPlaylist(id: string, uid: string): Promise<Playlist> {
  const { data } = await client.delete<Playlist>(`/playlists/${id}/tracks/${uid}`)
  return data
}

/** Download every song in the playlist that isn't on disk yet, as one job. */
export async function downloadPlaylist(
  id: string,
  quality: Quality,
  lyrics: boolean,
): Promise<{ job_id: string; name: string; tracks: { id: string; title: string }[] }> {
  const { data } = await client.post<{
    job_id: string
    name: string
    tracks: { id: string; title: string }[]
  }>(`/playlists/${id}/download`, { quality, lyrics })
  return data
}

/** One song known only by its metadata — what the player has for a stream.
 *  Resolves to the job, shaped like a playlist's so the dock can show it. */
export async function downloadSong(
  song: PlaylistTrackInput,
  quality: Quality,
  lyrics: boolean,
): Promise<{ job_id: string; name: string; tracks: { id: string; title: string }[] }> {
  const { data } = await client.post<{
    job_id: string
    name: string
    tracks: { id: string; title: string }[]
  }>('/download/song', { ...song, quality, lyrics })
  return data
}

export type PlaylistFormat = 'json' | 'm3u8'

/** Writes the export into the music folder's Playlists/ and answers with
 *  where it landed, for the shell to reveal. */
export async function exportPlaylist(
  id: string,
  format: PlaylistFormat,
): Promise<{ path: string; dir: string; filename: string }> {
  const { data } = await client.post<{ path: string; dir: string; filename: string }>(
    `/playlists/${id}/export`,
    { format },
  )
  return data
}

export async function importPlaylist(text: string, filename: string): Promise<Playlist> {
  const { data } = await client.post<Playlist>('/playlists/import', { text, filename })
  return data
}

/** Full-length playback of a song that isn't on disk, relayed by the backend
 *  — see backend/app/stream.py. Keyed by metadata, so any row can play. */
export function streamUrl(song: {
  title: string
  artists: string[]
  album?: string
  duration_ms?: number
  source_url?: string | null
}): string {
  const params = new URLSearchParams({ title: song.title })
  if (song.artists.length > 0) params.set('artist', song.artists.join(', '))
  if (song.album) params.set('album', song.album)
  if (song.duration_ms) params.set('duration_ms', String(song.duration_ms))
  if (song.source_url) params.set('source_url', song.source_url)
  return `/api/stream?${params.toString()}`
}

/** A song autoplay could queue next: catalog metadata, plus the library file
 *  when it is already on disk. */
export interface Recommendation {
  id: string
  title: string
  artists: string[]
  album: string
  duration_ms: number
  cover_url: string | null
  source_url: string | null
  file_id: string | null
}

/** Songs like this one, for autoplay — see backend/app/recommend.py. */
export async function getRecommendations(
  title: string,
  artist: string,
  signal?: AbortSignal,
): Promise<Recommendation[]> {
  const { data } = await client.get<{ tracks: Recommendation[] }>('/recommend', {
    params: { title, artist },
    signal,
  })
  return data.tracks
}
