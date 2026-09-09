/** The canonical dictionary. Its shape *is* the contract — `Messages` is
 *  derived from it, so every other locale is a type error until it supplies
 *  the same keys with the same signatures.
 *
 *  Anything that interpolates a value or counts something is a function, which
 *  keeps plural rules and number formatting inside the locale that needs them
 *  rather than in a shared engine that has to know about all of them. Copy
 *  this file to add a language; see `../i18n.tsx` for how to register it.
 *
 *  Sentences that wrap an element mid-phrase are split into `…Before` /
 *  `…After` halves, because word order around the element is the translator's
 *  problem, not the component's. */
const en = {
  app: {
    name: 'Unstream',
    home: 'Home',
    /** Wraps a quoted fragment — a search term, a track title. The marks are
     *  the locale's own, so Farsi gets «…» where English gets “…”. */
    quote: (text: string) => `“${text}”`,
    /** A number the UI is stating in its own voice: a count, an index, a
     *  duration, a percentage. The locale renders its own digits, so nothing
     *  relies on the font to transliterate — which is what let Persian digits
     *  leak into "MP3" and "24K Magic". Technical tokens (bitrates, file
     *  extensions) deliberately do not go through this. */
    num: (value: number | string) => String(value),
  },

  language: {
    label: 'Language',
    picker: 'Choose a language',
  },

  /** The sheet the header's controls move into on a narrow screen. */
  settings: {
    label: 'Settings',
    open: 'Open settings',
    close: 'Close settings',
    downloadsFolder: 'Downloads folder',
    downloadsLocation: 'Download destination',
    changeFolder: 'Change folder',
    openInFinder: 'Open folder',
    resetDefault: 'Reset to default',
    defaultFolderHint: 'Default: ~/Music/Unstream',
    folderSaved: 'Folder updated',
    appVersion: (v: string) => `App version ${v}`,
    ytdlpVersion: (v: string) => `yt-dlp ${v}`,
    serverUrl: 'Server URL',
    serverUrlHint: 'Metadata & search server',
    saveServer: 'Save',
    resetServer: 'Reset',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking for updates…',
    upToDate: 'Up to date',
    updateAvailable: (v: string) => `Update available (${v})`,
    installUpdate: 'Install & relaunch',
    installing: 'Installing…',
    updateFailed: 'Update failed — try again later',
    restartApp: 'Restart app',
    updateReady: 'Update installed! Restart the app to apply.',
  },

  banner: {
    youtubeDisabled:
      'YouTube downloads are disabled on this instance. Use the Unstream desktop app for unlimited local downloads.',
    getApp: 'Get Desktop App',
  },

  /** The dedicated `/download` page. Version and file links resolve at run
   *  time from the latest GitHub release, so publishing a new release updates
   *  the page with no code change. */
  download: {
    eyebrow: 'Desktop app',
    title: 'Download the app',
    blurb:
      'Unlimited local downloads at the quality you pick, with lyrics saved into the file. It runs entirely on your machine — no account, no server in between.',
    promoBlurb:
      'Unlimited local downloads with lyrics in the file. It runs entirely on your machine.',
    version: (v: string) => `Version ${v}`,
    latest: 'Latest',
    loading: 'Finding the latest version…',
    failed: "Couldn't reach GitHub for the latest version — the full list is still there.",
    retry: 'Try again',
    viewAll: 'All downloads on GitHub',
    backHome: 'Back to Unstream',
    /** Accessible name for a file button; the visible label stays the bare
     *  filename, which is a technical token and never translated. */
    downloadFor: (detail: string) => `Download ${detail}`,
    otherPlatforms: 'Other platforms',
    mac: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    appleSilicon: 'Apple Silicon',
    intel: 'Intel',
    bit64: '64-bit',
    arm64: 'ARM',
    setupInstaller: 'Installer',
    portableImage: 'Portable',
    package: 'Package',
    macStepsTitle: 'Opening it on a Mac',
    /** Unsigned-build help. The commands are code, not copy — they stay Latin
     *  in every locale; only the explanation is translated. */
    macStepInstall: 'Install the .dmg, then clear the quarantine flag:',
    macStepResign:
      'If it still says the app is damaged, re-sign it locally (this is what fixes it when clearing alone does not):',
    macStepOpen:
      'Then open it with right-click → Open once, or allow it in System Settings → Privacy & Security.',
    heroTitle: 'All your music. Truly offline.',
    heroSubtitle:
      'High-fidelity downloads, synchronized lyrics baked into your files, and a dedicated offline player. Runs 100% on your machine with zero accounts or subscriptions.',
    downloadForPlatform: (p: string) => `Download for ${p}`,
    otherOptionsFor: (p: string) => `Other options for ${p}`,
    allPlatformsTitle: 'All Platforms & Packages',
    allPlatformsSubtitle: 'Native binaries built and optimized for your processor architecture.',
    featuresTitle: 'Engineered for pure listening',
    featuresSubtitle: 'Everything you love about Unstream, natively optimized for your desktop.',
    featureLocalTitle: '100% Local & Private',
    featureLocalDesc:
      'Runs completely on your machine. No accounts, no sign-ups, and no intermediate servers touching your audio.',
    featureAudioTitle: 'Lossless & 320 kbps',
    featureAudioDesc:
      'Save crystal-clear MP3s or original lossless audio, tagged with verified cover artwork and full ID3 metadata.',
    featureLyricsTitle: 'Embedded Synced Lyrics',
    featureLyricsDesc:
      'Time-synced lyrics embedded directly into your files, ready for any offline media player or karaoke.',
    featurePlayerTitle: 'Built-in Player & Library',
    featurePlayerDesc:
      'Browse your offline music library, play songs with real-time waveform visualizers, and sing along in karaoke view.',
    macStepsSubtitle:
      'Because Unstream is community-built and unsigned, macOS Gatekeeper may show a warning. Follow these two quick commands:',
    macStepsTab: 'macOS Gatekeeper Guide',
    showMacGuide: 'Show macOS Gatekeeper guide',
    hideMacGuide: 'Hide guide',
    selectPlatform: 'Select platform',
    previewNowPlaying: 'Now Playing',
    previewLyricsPreview: 'Live Synced Lyrics',
    copy: 'Copy',
    copied: 'Copied',
    yourPlatform: 'Your OS',
    runningLocally: 'You are currently running Unstream locally on this machine.',
  },

  /** The document's own metadata — `<title>`, the description, Open Graph and
   *  Twitter cards. Applied to the live document whenever the language changes
   *  (see `../i18n.tsx`), so a shared link carries the copy of the language the
   *  sharer was reading.
   *
   *  Caveat worth knowing: a crawler that does not run JavaScript sees the
   *  build's static values in index.html, which are the default language's. */
  meta: {
    title: 'Download music, albums and playlists from Spotify and YouTube | Unstream',
    description:
      'Paste a Spotify, YouTube, SoundCloud or Deezer link, or search every catalog at once, and download tracks, albums and playlists as tagged MP3 files at up to 320 kbps — free, no account.',
    /** Open Graph wants a full locale, not a bare language tag. */
    ogLocale: 'en_US',
    /** Install identity for the PWA. One static file per language, because a
     *  manifest has to be a real same-origin URL — keep in sync with
     *  `public/manifest*.webmanifest`. */
    manifest: '/manifest.en.webmanifest',
  },

  quality: {
    label: 'Quality',
    group: 'Audio quality',
    original: 'Original',
    hints: {
      '128': 'Smallest files — fine for podcasts, or a phone that is out of room.',
      '192': 'The default. Good quality at roughly half the size of 320.',
      '320': 'The best mp3 can do, and it plays everywhere.',
      original:
        "No re-encode — the upload's own m4a or opus. Best sound, largest files, and some older devices won't play them.",
    },
  },

  desktopNav: {
    search: 'Search & Explore',
    downloads: 'Downloads',
    library: 'Library',
    settings: 'Settings',
    openFolder: 'Open Folder',
    activeDownloads: (n: number) => `${n} active`,
    completed: 'Completed',
    musicDownloader: 'Music downloader',
    navigationLabel: 'Desktop navigation',
    noActiveDownloads: 'No active downloads',
    noCompletedDownloads: 'No completed downloads yet',
    emptyDownloadsHint:
      'Search for a track, album, or artist to start building your offline music library.',
    settingsDescription: 'Fine-tune audio, file organization, language, and app updates.',
    audioDefaults: 'Audio defaults',
    audioDefaultsHint: 'These options apply to every new download.',
    languageHint: 'Choose the language and reading direction used throughout Unstream.',
    downloadsFolderHint: 'Finished albums and tracks are organized inside this folder.',
    about: 'About Unstream',
    appName: 'Unstream Desktop',
    newVersion: 'New version available:',
    builtBy: 'Built by',
    and: 'and',
    totalDownloads: 'Total',
    clearCompleted: 'Clear completed',
    revealInFolder: 'Reveal in folder',
    commandPaletteHint: 'Search or paste link…',
    supportedSources: 'Supported services',
    offlineLibrary: 'Offline Music Library',
    keyboardShortcut: 'Shortcut',
    quickActions: 'Quick actions',
    window: {
      minimize: 'Minimize',
      maximize: 'Maximize',
      restore: 'Restore',
      close: 'Close',
    },
  },

  palette: {
    placeholder: 'Type a command, search, or paste a link…',
    searchFor: (q: string) => `Search for "${q}"`,
    openLink: 'Open this link',
    recent: 'Recent',
    empty: 'Nothing matches — press Enter to search anyway',
  },

  cookies: {
    title: 'Browser cookies',
    hint: 'If YouTube asks for a sign-in mid-download, pick the browser you are signed into YouTube in. Downloads use your own account, on your own machine.',
    off: 'Off',
    saved: 'Saved',
    failed: 'Could not save — try again',
    noneFound: 'No supported browser found on this device',
  },

  player: {
    play: 'Play',
    pause: 'Pause',
    next: 'Next track',
    previous: 'Previous track',
    seek: 'Seek',
    close: 'Close the player',
    karaoke: 'Karaoke',
    upNext: 'Up next',
    searchLibrary: 'Search your library…',
    refresh: 'Rescan the folder',
    empty: 'No music yet',
    emptyHint: 'Finished downloads land here — press play on anything.',
    trackCount: (n: number) => `${n} songs`,
    unknownArtist: 'Unknown artist',
    playAll: 'Play all',
    shuffleAll: 'Shuffle all',
    shuffle: 'Shuffle',
    repeat: {
      off: 'Repeat off',
      all: 'Repeat all',
      one: 'Repeat this song',
    },
    volume: 'Volume',
    mute: 'Mute',
    unmute: 'Unmute',
    unplayable: "This file can't be played — it may have moved",
    lyricsOnDisk: 'Lyrics from this file',
    sortRecent: 'Newest',
    sortTitle: 'Title',
    sortArtist: 'Artist',
  },

  hero: {
    titleLine1: 'Download music,',
    titleLine2: 'albums and playlists',
    blurb:
      'Paste a Spotify, YouTube, SoundCloud, Deezer or Apple Music link — or search every catalog at once. Get tagged MP3 files with cover art at the quality you pick. No account, no sign-up.',
    shortcutBefore: 'Press',
    shortcutAfter: 'to search, or paste a link anywhere on the page.',
    appEmpty: 'Paste a link or search — files land in Music/Unstream',
  },

  form: {
    placeholder:
      'Search for a track, album or artist — or paste a Spotify / Deezer / YouTube / SoundCloud link',
    opening: 'Opening…',
    searching: 'Searching…',
    open: 'Open',
    search: 'Search',
    cancelSearch: 'Stop searching',
    cancelOpen: 'Stop opening this link',
  },

  recent: {
    heading: 'Recent searches',
    clear: 'Clear recent searches',
  },

  nav: {
    back: 'Back',
    backToResults: 'Back to results',
    backToArtist: 'Back to artist',
  },

  shared: {
    badge: 'Shared link',
    titleError: "This shared link wouldn't open",
    titleQuery: 'Someone sent you a search',
    titleBusy: 'Opening what was shared with you…',
    titleDefault: 'Someone shared this with you',
    bodyError: "The link may be broken or private, or from a source Unstream can't read.",
    queryBefore: 'Results for',
    queryAfter: '— opened automatically from the link you followed.',
    bodyDefault:
      'Unstream opened this straight from your link. Pick the tracks you want, or start fresh.',
    searchElse: 'Search for something else',
  },

  results: {
    resultsFor: 'Results for',
    count: (n: number, more: boolean) =>
      `${n} ${n === 1 ? 'result' : 'results'}${more ? ' so far' : ''}`,
    filter: 'Filter results',
    all: 'All',
    showAll: (n: number) => `Show all ${n}`,
    searchingDeeper: 'Searching deeper…',
    emptyBefore: 'Nothing found for',
    emptyAfter: '',
    emptyHint: "Try just the artist's name, check the spelling, or paste the album link instead.",
    /** Per kind, because English pluralises and other languages may not. */
    kinds: {
      track: {
        label: 'Tracks',
        more: 'More tracks',
        exhausted: (n: number) =>
          `That's everything — ${n} ${n === 1 ? 'track' : 'tracks'} across every source.`,
      },
      artist: {
        label: 'Artists',
        more: 'More artists',
        exhausted: (n: number) =>
          `That's everything — ${n} ${n === 1 ? 'artist' : 'artists'} across every source.`,
      },
      album: {
        label: 'Albums',
        more: 'More albums',
        exhausted: (n: number) =>
          `That's everything — ${n} ${n === 1 ? 'album' : 'albums'} across every source.`,
      },
      playlist: {
        label: 'Playlists',
        more: 'More playlists',
        exhausted: (n: number) =>
          `That's everything — ${n} ${n === 1 ? 'playlist' : 'playlists'} across every source.`,
      },
    },
  },

  collection: {
    kinds: { track: 'Track', album: 'Album', playlist: 'Playlist' },
    trackCount: (n: number) => `${n} ${n === 1 ? 'track' : 'tracks'}`,
    /** Total running time of everything in the collection. */
    duration: (ms: number) => {
      const minutes = Math.round(ms / 60000)
      if (minutes < 60) return `${minutes} min`
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest ? `${hours} hr ${rest} min` : `${hours} hr`
    },
    copy: 'Copy a share link to this page',
    copyShort: 'Copy share link',
    copied: 'Share link copied',
    copyFailed: "Couldn't copy the link",
    clearSelection: 'Clear selection',
    downloadSelected: (n: number) => `Download ${n} selected`,
    downloadAll: 'Download all',
    starting: 'Starting…',
    selectedOf: (n: number, total: number) => `${n} of ${total} selected`,
    tickShort: 'Tick to select',
    tickLong: 'Tick any of them and only those get downloaded',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    finished: (done: number, total: number) => `Done — ${done} of ${total} downloaded`,
    failedCount: (n: number) => `${n} failed`,
    queuedAll: (n: number, name: string) =>
      `${n} ${n === 1 ? 'track' : 'tracks'} from ${name} added to the queue`,
    queuedSome: (n: number) => `${n} ${n === 1 ? 'track' : 'tracks'} added to the queue`,
    queuedOne: (title: string) => `“${title}” added to the queue`,
  },

  /** Shared by the track rows and the downloads dock. */
  stages: {
    queued: 'Queued',
    searching: 'Searching…',
    downloading: 'Downloading',
    tagging: 'Tagging…',
    retrying: 'Retrying…',
  },

  track: {
    select: (title: string) => `Select ${title}`,
    previewStop: 'Stop preview',
    previewPlay: 'Play a 30 second preview',
    previewStopFor: (title: string) => `Stop the preview of ${title}`,
    previewPlayFor: (title: string) => `Play 30 seconds of ${title}`,
    failed: 'Failed',
    startingDownload: 'Starting the download…',
    download: 'Download this track',
    downloadFor: (title: string) => `Download ${title}`,
  },

  lyrics: {
    label: 'Lyrics',
    dialog: (title: string) => `Lyrics for ${title}`,
    open: (title: string) => `Show the lyrics for ${title}`,
    copy: 'Copy the lyrics',
    copied: 'Lyrics copied',
    copyFailed: "Couldn't copy the lyrics",
    close: 'Close the lyrics',
    retry: 'Try again',
    /** Footer credit. The source names themselves are proper nouns and are
     *  not translated. */
    source: 'Source',
    /** The sources didn't answer — worth a retry. */
    unavailable: {
      title: "Couldn't reach the lyrics sources",
      hint: 'They may be busy, or blocked from here. Give it a moment and try again.',
    },
    /** The sources answered and none of them has this song. No retry: asking
     *  the same question again gets the same answer. */
    absent: {
      title: 'No lyrics for this one',
      hint: "Either the catalogs don't carry it yet, or the track is filed under a different name.",
    },
    /** The preference, not the sheet: whether a finished download gets the
     *  words written into its tags. Its own label, because the header is
     *  narrow and it has to fit beside "Quality". */
    embed: {
      label: 'Lyrics',
      action: 'Save the lyrics inside the downloaded file',
      on: 'Lyrics are saved inside the downloaded file',
      off: 'Lyrics are not saved inside the downloaded file',
    },
  },

  dock: {
    heading: 'Downloads',
    close: 'Close the downloads panel',
    show: 'Show downloads',
    activeSummary: (n: number) => `${n} running`,
    doneSummary: (n: number) => `${n} finished`,
    expired: 'The files are no longer on the server — download it again',
    progress: (done: number, total: number) => `${done} of ${total} downloaded`,
    failedCount: (n: number) => `${n} failed`,
    /** How much longer the job has to run. */
    eta: (seconds: number) => {
      if (seconds < 60) return `about ${seconds}s left`
      const minutes = Math.round(seconds / 60)
      return `about ${minutes} min left`
    },
    originalQuality: 'Downloaded without re-encoding',
    encodedQuality: (kbps: string) => `Encoded at ${kbps} kbps`,
    zip: 'Download everything as a ZIP',
    zipLong: 'Download all tracks as a ZIP',
    remove: 'Remove from the list',
    starting: 'Starting…',
    downloadFile: (title: string, ext: string) => `Download ${title}.${ext}`,
    downloadFileLong: (title: string, ext: string) => `Download ${title} as ${ext}`,
    revealInFolder: (title: string) => `Reveal ${title} in folder`,
    playTrack: (title: string) => `Play ${title}`,
    openFolder: 'Open downloads folder',
    failed: 'Failed',
    deleted: 'Deleted',
    /** Stopping a job in progress. Whatever has already finished is kept, so
     *  this says "stop" rather than anything that sounds like undoing it. */
    cancel: 'Stop this download',
    cancelling: 'Stopping…',
    cancelled: 'Stopped',
    cancelledCount: (n: number) => `${n} stopped`,
    retry: 'Retry',
  },

  share: {
    action: (title: string) => `Share or save ${title}`,
    actionShort: (title: string) => `Share ${title}`,
    unsupported: "This browser can't share files",
    failed: "The file wasn't ready to share",
  },

  quick: {
    done: "Downloaded — it's in your list",
    running: 'Downloading…',
    original: 'Download without re-encoding',
    kbps: (kbps: string) => `Download at ${kbps} kbps`,
    download: (name: string) => `Download ${name}`,
    queued: (name: string) => `“${name}” added to the queue`,
  },

  artist: {
    badge: 'Artist',
    releases: (n: number) => `${n} ${n === 1 ? 'release' : 'releases'}`,
    fans: (n: number) =>
      n >= 1_000_000
        ? `${(n / 1_000_000).toFixed(1)}M followers`
        : n >= 1_000
          ? `${Math.round(n / 1_000)}K followers`
          : `${n} ${n === 1 ? 'follower' : 'followers'}`,
    topTracks: 'Top tracks',
    discography: 'Discography',
  },

  notify: {
    ready: (name: string, n: number) =>
      `${name} — ${n} ${n === 1 ? 'track' : 'tracks'} ready to save`,
    partial: (name: string, done: number, failed: number) =>
      `${name} — ${done} ready, ${failed} failed to download`,
    failed: (name: string) => `${name} — download failed`,
    /** After a cancel. `done` is what had already landed and is still there to
     *  save, which is the only part of this the user doesn't already know. */
    cancelled: (name: string, done: number) =>
      done > 0 ? `${name} — stopped, ${done} still ready to save` : `${name} — download stopped`,
    linkDetected: 'Link detected — opening…',
    newVersion: 'A new version of Unstream is available',
    refresh: 'Refresh',
    close: 'Dismiss notification',
  },

  /** One ' · '-separated segment of a backend-composed result subtitle ("5
   *  releases", "by X", "Artist", "SINGLE"). Called per segment so anything
   *  unrecognised — artist names, years — passes through untouched. The wire
   *  stays English; this is the seam that renders it in the UI's language. */
  subtitle: (part: string) =>
    part
      .replace(/^SINGLE$/, 'Single')
      // The backend composes these counts without agreeing the noun, which a
      // language with no plural after a numeral never had to notice.
      .replace(/^1 (release|track|follower)s$/, '1 $1'),

  /** Rewrites of the backend's terse `detail` strings. `n` is whatever number
   *  the backend put in the message. */
  errors: {
    tooManySearches: (n: string) => `That's a lot of searching — wait ${n}s and try again.`,
    tooManyLinks: (n: string) => `That's a lot of links — wait ${n}s and try again.`,
    tooManyDownloads: (n: string) => `You've hit the download limit for now — try again in ${n}s.`,
    downloadsAtOnce: 'Several downloads are already running — wait for one to finish.',
    tooManyTracks: (n: string) => `That list is too long — ${n} tracks at a time is the limit.`,
    unsupportedLink:
      "That link isn't supported — paste a Spotify, Deezer, Apple Music, YouTube or SoundCloud link, or search for the name instead.",
    noTracksSelected: 'No tracks are selected.',
    nothingFinished: 'Nothing has finished downloading yet.',
    notReady: "That file isn't ready yet.",
    unknownJob: 'That download is no longer on the server.',
    emptyQuery: "You haven't typed anything to search for.",
    badRequest: "That link wouldn't open — it may be private, or its source unavailable.",
    notFound: 'Not found.',
    rateLimited: "That's a bit fast — give it a moment.",
    noAnswer: "The server didn't answer — give it another try.",
    offline: "Couldn't reach the server — check your connection.",
    unknown: 'Something went wrong',
  },
}

export type Messages = typeof en

export default en
