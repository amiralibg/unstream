import { useMemo, useState } from 'react'
import {
  Apple,
  AudioLines,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FolderDown,
  FolderOpen,
  Grid2x2,
  HardDrive,
  ListMusic,
  Mic2,
  Music,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import { LocaleProvider, useDirectional, useMessages } from '../lib/i18n'
import { LanguagePicker } from './LanguagePicker'
import { isLocal } from '../lib/desktop'
import { RELEASES_URL, detectArm, detectOS, filesFor, useRelease, type OS } from '../lib/release'

const MAC_QUARANTINE_CMD = 'sudo xattr -cr /Applications/Unstream.app'
const MAC_RESIGN_CMD = 'sudo codesign --force --deep --sign - /Applications/Unstream.app'

function CopyButton({
  text,
  label,
  copiedLabel,
}: {
  text: string
  label: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => {})
      }}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-ctl border border-ink-700 bg-ink-800/80 px-2.5 py-1 text-micro font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100 active:scale-95"
    >
      {copied ? (
        <>
          <Check className="size-3 text-lime-flash" />
          <span className="text-lime-flash">{copiedLabel}</span>
        </>
      ) : (
        <>
          <Copy className="size-3 text-ink-400" />
          <span>{label}</span>
        </>
      )}
    </button>
  )
}

const OS_ICONS = { mac: Apple, windows: Grid2x2, linux: Terminal } as const

/** Stylized, high-fidelity interactive showcase mockup of the desktop application */
function DesktopAppShowcase() {
  const m = useMessages()
  const t = m.download

  return (
    <div className="relative mx-auto w-full max-w-3xl select-none">
      {/* Ambient background glow behind window */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-3 -z-10 rounded-[2.5rem] bg-gradient-to-b from-lime-flash/15 via-lime-flash/5 to-transparent blur-2xl"
      />

      {/* Main Window Frame */}
      <div className="overflow-hidden rounded-panel border border-ink-750 bg-[#0c0e0b] shadow-[0_25px_70px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition duration-300">
        {/* Titlebar */}
        <div
          dir="ltr"
          className="flex h-11 items-center justify-between border-b border-ink-800/80 bg-black/40 px-4"
        >
          {/* macOS Traffic Lights */}
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f56]/90 shadow-sm" />
            <span className="size-3 rounded-full bg-[#ffbd2e]/90 shadow-sm" />
            <span className="size-3 rounded-full bg-[#27c93f]/90 shadow-sm" />
          </div>

          {/* Centered Mock Search Bar */}
          <div className="flex h-7 w-full max-w-sm items-center justify-between gap-2 rounded-ctl border border-ink-750 bg-ink-800/40 px-2.5 text-micro text-ink-400">
            <div className="flex items-center gap-1.5 truncate">
              <Search className="size-3 text-ink-400" />
              <span className="truncate">{m.palette.placeholder}</span>
            </div>
            <kbd className="shrink-0 rounded bg-ink-700/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
              ⌘K
            </kbd>
          </div>

          {/* Window Meta Indicator */}
          <div className="hidden items-center gap-2 sm:flex">
            <span className="inline-flex items-center gap-1 rounded-full border border-lime-flash/30 bg-lime-flash/10 px-2 py-0.5 text-[10px] font-semibold text-lime-flash">
              <span className="size-1.5 rounded-full bg-lime-flash animate-pulse" />
              320 kbps MP3
            </span>
          </div>
        </div>

        {/* Window Interior */}
        <div className="flex flex-col sm:flex-row">
          {/* Mini Sidebar */}
          <aside className="hidden w-44 shrink-0 border-e border-ink-800/80 bg-[#090b08]/90 p-3 sm:flex sm:flex-col sm:justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-2 pt-1">
                <span className="grid size-6 place-items-center rounded-ctl bg-lime-flash text-lime-ink">
                  <AudioLines className="size-3.5" strokeWidth={2.5} />
                </span>
                <span className="font-display text-mini font-bold text-ink-100">{m.app.name}</span>
              </div>

              {/* Navigation Items */}
              <nav className="space-y-1 text-mini">
                <div className="flex items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-ink-400 transition hover:bg-white/[0.04] hover:text-ink-200">
                  <Search className="size-4" />
                  <span>{m.desktopNav.search}</span>
                </div>
                <div className="flex items-center justify-between rounded-ctl px-2.5 py-1.5 text-ink-400 transition hover:bg-white/[0.04] hover:text-ink-200">
                  <div className="flex items-center gap-2.5">
                    <FolderDown className="size-4" />
                    <span>{m.desktopNav.downloads}</span>
                  </div>
                  <span className="rounded-full bg-lime-flash/20 px-1.5 py-0.2 font-mono text-[10px] font-bold text-lime-flash">
                    3
                  </span>
                </div>
                <div className="flex items-center gap-2.5 rounded-ctl bg-ink-800/80 px-2.5 py-1.5 font-semibold text-lime-flash">
                  <ListMusic className="size-4" />
                  <span>{m.desktopNav.library}</span>
                </div>
                <div className="flex items-center gap-2.5 rounded-ctl px-2.5 py-1.5 text-ink-400 transition hover:bg-white/[0.04] hover:text-ink-200">
                  <Settings className="size-4" />
                  <span>{m.desktopNav.settings}</span>
                </div>
              </nav>
            </div>

            {/* Folder location indicator */}
            <div
              dir="ltr"
              className="mt-6 rounded-ctl border border-ink-800/60 bg-ink-900/60 p-2 text-[11px] text-ink-400"
            >
              <div className="flex items-center gap-1.5 text-ink-300">
                <HardDrive className="size-3 text-lime-flash" />
                <span className="font-medium">Music Directory</span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-400">~/Music/Unstream</p>
            </div>
          </aside>

          {/* Main Showcase Panel */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            {/* Now Playing / Active Track Card */}
            <div className="relative overflow-hidden rounded-btn border border-ink-800 bg-gradient-to-br from-ink-850 via-ink-900 to-ink-950 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5 min-w-0">
                  {/* Album Cover Mock */}
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-ctl border border-white/10 bg-gradient-to-tr from-lime-900/60 via-emerald-800/40 to-ink-800 shadow-md">
                    <div className="absolute inset-0 grid place-items-center text-lime-flash/80">
                      <Music className="size-6" />
                    </div>
                    <span className="absolute bottom-1 end-1 grid size-3.5 place-items-center rounded-full bg-lime-flash text-lime-ink">
                      <Play className="size-2 fill-current" />
                    </span>
                  </div>

                  {/* Track Info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-lime-flash/15 px-1.5 py-0.5 text-[10px] font-bold text-lime-flash">
                        {t.previewNowPlaying}
                      </span>
                      <span className="font-mono text-[11px] text-ink-400">03:42</span>
                    </div>
                    <h3 className="mt-1 truncate font-display text-body font-bold text-ink-100">
                      Gole Yakh (گل یخ)
                    </h3>
                    <p className="truncate text-mini text-ink-400">Kourosh Yaghmaei</p>
                  </div>
                </div>

                {/* Animated EQ Audio Visualizer */}
                <div className="flex items-center gap-1 shrink-0">
                  {[40, 75, 100, 60, 90, 45, 80, 50, 95, 30].map((h, idx) => (
                    <span
                      key={idx}
                      style={{ height: `${h * 0.26}px`, animationDelay: `${idx * 80}ms` }}
                      className="w-1 rounded-full bg-lime-flash/90 animate-eq"
                    />
                  ))}
                </div>
              </div>

              {/* Synchronized Lyrics Live Preview */}
              <div className="mt-4 rounded-ctl border border-ink-800/80 bg-black/40 p-3.5">
                <div className="flex items-center justify-between text-micro text-ink-400">
                  <span className="flex items-center gap-1.5 font-medium text-lime-flash">
                    <Mic2 className="size-3" />
                    {t.previewLyricsPreview}
                  </span>
                  <span className="font-mono text-[10px] text-ink-400">LRC Synchronized</span>
                </div>

                <div className="mt-2.5 space-y-1.5 text-mini">
                  <p className="text-ink-400 opacity-60">غم میونِ دو تا چشمونِ قشنگت لونه کرده…</p>
                  <p className="rounded-ctl bg-lime-flash/10 px-2.5 py-1 font-semibold text-lime-flash shadow-sm">
                    دلم از دستِ زمونه، دیگه دلگیر و بی‌قراره…
                  </p>
                  <p className="text-ink-400 opacity-80">شبِ تاریک و سیاه، پر از ابرهای سفیده…</p>
                </div>
              </div>

              {/* Completed Downloads Shelf */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-micro text-ink-400">
                  <span className="font-medium text-ink-300">{m.desktopNav.completed}</span>
                  <span className="font-mono text-[10px] text-ink-400">Tagged & Saved</span>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { title: 'Random Access Memories', artist: 'Daft Punk' },
                    { title: 'In Rainbows', artist: 'Radiohead' },
                    { title: 'To Pimp A Butterfly', artist: 'Kendrick Lamar' },
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-ctl border border-ink-800/80 bg-ink-900/60 p-2 transition hover:border-ink-700"
                    >
                      <div className="grid size-7 shrink-0 place-items-center rounded-ctl bg-ink-800 text-ink-400">
                        <Check className="size-3.5 text-lime-flash" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold text-ink-200">
                          {item.title}
                        </p>
                        <p className="truncate text-[10px] text-ink-400">{item.artist}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Shell() {
  const m = useMessages()
  const t = m.download
  const { Back } = useDirectional()
  const { release, failed, loading, reload, pick } = useRelease()
  const [detectedOs] = useState<OS>(detectOS)
  const [arm] = useState<boolean | null>(detectArm)
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
  const [showMacGuide, setShowMacGuide] = useState<boolean>(() => detectOS() === 'mac')
  const local = isLocal()

  const files = release ? filesFor(release.version) : null

  /** Check if a specific release asset is published in the active release */
  const hasAsset = (fileName: string) => {
    if (!release) return true
    if (!release.live) return true
    return release.assets.some((a) => a.name === fileName)
  }

  /** Variants available for visitor's detected OS */
  const osVariants = useMemo(() => {
    if (!files) return []
    if (detectedOs === 'mac') {
      return [
        {
          id: 'mac-arm',
          label: t.appleSilicon,
          detail: 'Apple Silicon (M1–M4)',
          file: files.macArm,
          ext: '.dmg',
          available: hasAsset(files.macArm),
        },
        {
          id: 'mac-intel',
          label: t.intel,
          detail: 'Intel 64-bit',
          file: files.macIntel,
          ext: '.dmg',
          available: hasAsset(files.macIntel),
        },
      ]
    }
    if (detectedOs === 'windows') {
      return [
        {
          id: 'win-x64-exe',
          label: `${t.bit64} ${t.setupInstaller}`,
          detail: 'Standard .exe',
          file: files.winX64Exe,
          ext: '.exe',
          available: hasAsset(files.winX64Exe),
        },
        {
          id: 'win-x64-msi',
          label: `${t.bit64} MSI`,
          detail: 'Enterprise .msi',
          file: files.winX64Msi,
          ext: '.msi',
          available: hasAsset(files.winX64Msi),
        },
        {
          id: 'win-arm-exe',
          label: `${t.arm64} ${t.setupInstaller}`,
          detail: 'ARM64 .exe',
          file: files.winArmExe,
          ext: '.exe',
          available: hasAsset(files.winArmExe),
        },
      ]
    }
    return [
      {
        id: 'lin-x64-app',
        label: `${t.bit64} ${t.portableImage}`,
        detail: 'AppImage',
        file: files.linX64App,
        ext: '.AppImage',
        available: hasAsset(files.linX64App),
      },
      {
        id: 'lin-x64-deb',
        label: `${t.bit64} ${t.package}`,
        detail: 'Debian / Ubuntu',
        file: files.linX64Deb,
        ext: '.deb',
        available: hasAsset(files.linX64Deb),
      },
      {
        id: 'lin-arm-app',
        label: `${t.arm64} ${t.portableImage}`,
        detail: 'ARM64 AppImage',
        file: files.linArmApp,
        ext: '.AppImage',
        available: hasAsset(files.linArmApp),
      },
    ]
  }, [files, detectedOs, t, release])

  /** Determine default variant based on ARM detection */
  const activeVariant = useMemo(() => {
    if (selectedVariant) {
      const match = osVariants.find((v) => v.id === selectedVariant)
      if (match) return match
    }
    if (detectedOs === 'mac') {
      const armVariant = osVariants[0]
      const intelVariant = osVariants[1]
      if (arm === false && intelVariant?.available) return intelVariant
      return armVariant ?? osVariants[0]
    }
    if (detectedOs === 'windows') {
      return arm === true ? (osVariants[2] ?? osVariants[0]) : osVariants[0]
    }
    if (detectedOs === 'linux') {
      return arm === true ? (osVariants[2] ?? osVariants[0]) : osVariants[0]
    }
    return osVariants[0] ?? null
  }, [selectedVariant, osVariants, detectedOs, arm])

  const activeDownloadUrl = activeVariant?.file ? pick(activeVariant.file) : null
  const isAvailable = activeVariant?.available ?? false

  /** All platforms configuration for matrix */
  const allPlatforms = useMemo(() => {
    if (!files) return []
    return [
      {
        id: 'mac' as const,
        name: t.mac,
        icon: Apple,
        archs: [
          {
            title: t.appleSilicon,
            subtitle: 'Apple Silicon (M1/M2/M3/M4)',
            links: [
              {
                label: '.dmg',
                name: files.macArm,
                ext: 'DMG',
                available: hasAsset(files.macArm),
              },
            ],
          },
          {
            title: t.intel,
            subtitle: 'Intel Processor',
            links: [
              {
                label: '.dmg',
                name: files.macIntel,
                ext: 'DMG',
                available: hasAsset(files.macIntel),
              },
            ],
          },
        ],
      },
      {
        id: 'windows' as const,
        name: t.windows,
        icon: Grid2x2,
        archs: [
          {
            title: t.bit64,
            subtitle: 'Windows 10, 11 (x64)',
            links: [
              {
                label: `.exe · ${t.setupInstaller}`,
                name: files.winX64Exe,
                ext: 'EXE',
                available: hasAsset(files.winX64Exe),
              },
              {
                label: '.msi',
                name: files.winX64Msi,
                ext: 'MSI',
                available: hasAsset(files.winX64Msi),
              },
            ],
          },
          {
            title: t.arm64,
            subtitle: 'Snapdragon & ARM64',
            links: [
              {
                label: `.exe · ${t.setupInstaller}`,
                name: files.winArmExe,
                ext: 'EXE',
                available: hasAsset(files.winArmExe),
              },
              {
                label: '.msi',
                name: files.winArmMsi,
                ext: 'MSI',
                available: hasAsset(files.winArmMsi),
              },
            ],
          },
        ],
      },
      {
        id: 'linux' as const,
        name: t.linux,
        icon: Terminal,
        archs: [
          {
            title: t.bit64,
            subtitle: 'x86_64 Distributions',
            links: [
              {
                label: `.AppImage · ${t.portableImage}`,
                name: files.linX64App,
                ext: 'AppImage',
                available: hasAsset(files.linX64App),
              },
              {
                label: `.deb · ${t.package}`,
                name: files.linX64Deb,
                ext: 'DEB',
                available: hasAsset(files.linX64Deb),
              },
            ],
          },
          {
            title: t.arm64,
            subtitle: 'AArch64 / ARM64',
            links: [
              {
                label: `.AppImage · ${t.portableImage}`,
                name: files.linArmApp,
                ext: 'AppImage',
                available: hasAsset(files.linArmApp),
              },
              {
                label: `.deb · ${t.package}`,
                name: files.linArmDeb,
                ext: 'DEB',
                available: hasAsset(files.linArmDeb),
              },
            ],
          },
        ],
      },
    ]
  }, [files, t, release])

  const PrimaryIcon = OS_ICONS[detectedOs]
  const detectedOsName = { mac: t.mac, windows: t.windows, linux: t.linux }[detectedOs]

  return (
    <div className="safe-x relative flex min-h-screen flex-col overflow-x-hidden bg-ink-950 text-ink-100">
      {/* Background ambient lighting glow */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[500px] w-[90vw] max-w-[56rem] rounded-full bg-[radial-gradient(ellipse_at_top,rgba(200,242,79,0.11),transparent_70%)] blur-2xl"
        aria-hidden="true"
      />

      <div className="relative z-10 flex-1">
        {/* Navigation Header */}
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 pt-[calc(1.5rem+var(--safe-top))] pb-4 select-none">
          <a
            href="/"
            aria-label={m.app.home}
            className="group flex items-center gap-2.5 rounded-ctl transition"
          >
            <span className="grid size-8 place-items-center rounded-ctl bg-lime-flash text-lime-ink transition duration-200 group-active:scale-95 shadow-sm shadow-lime-flash/25">
              <AudioLines className="size-4.5" strokeWidth={2.25} />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight transition-colors duration-200 group-hover:text-lime-flash">
              {m.app.name}
            </span>
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="group hidden items-center gap-1.5 rounded-ctl px-2.5 py-1.5 text-mini font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 active:scale-[0.98] sm:inline-flex"
            >
              <Back className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
              {t.backHome}
            </a>
            <div className="h-4 w-px bg-ink-800 hidden sm:block" />
            <LanguagePicker />
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              title="GitHub Releases"
              className="grid size-8 place-items-center rounded-ctl border border-ink-800 bg-ink-900/80 text-ink-300 transition hover:border-ink-700 hover:text-ink-100"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="mx-auto w-full max-w-4xl px-5 pt-4 pb-20">
          {/* Mobile Back Link */}
          <div className="mb-4 sm:hidden">
            <a
              href="/"
              className="group inline-flex items-center gap-1.5 rounded-ctl px-2 py-1 text-mini font-medium text-ink-300 transition hover:text-ink-100"
            >
              <Back className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
              {t.backHome}
            </a>
          </div>

          {/* Hero Section */}
          <section className="text-center pt-4 sm:pt-6 pb-2">
            {/* Version & Eyebrow Pill */}
            <div className="inline-flex items-center gap-2 rounded-full border border-lime-flash/30 bg-lime-flash/[0.08] px-3.5 py-1 text-mini font-semibold text-lime-flash shadow-sm animate-fade-up">
              <Sparkles className="size-3.5" />
              <span>{t.eyebrow}</span>
              <span className="size-1 rounded-full bg-lime-flash/60" />
              <span dir="ltr">{release ? t.version(release.version) : t.latest}</span>
            </div>

            {/* Headline */}
            <h1 className="mt-4 font-display text-[clamp(2.3rem,6.5vw,4rem)] font-bold tracking-tight leading-[1.12] text-balance text-ink-100 animate-fade-up [animation-delay:60ms]">
              {t.heroTitle}
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mt-4 max-w-2xl text-body leading-relaxed text-ink-300 text-pretty animate-fade-up [animation-delay:120ms]">
              {t.heroSubtitle}
            </p>

            {/* Localhost / local notice if running locally */}
            {local && (
              <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full border border-lime-flash/25 bg-lime-flash/[0.06] px-4 py-1.5 text-mini text-ink-200 animate-fade-up [animation-delay:150ms]">
                <Check className="size-3.5 text-lime-flash shrink-0" />
                <span>{t.runningLocally}</span>
              </div>
            )}
          </section>

          {/* Primary CTA Spotlight Card */}
          {loading && !release ? (
            <div
              className="mx-auto mt-8 max-w-xl animate-pulse rounded-panel border border-ink-800 bg-ink-900/60 p-8 space-y-4"
              aria-hidden="true"
            >
              <div className="h-6 w-48 rounded bg-ink-800 mx-auto" />
              <div className="h-14 w-full rounded-btn bg-ink-800" />
              <div className="h-4 w-32 rounded bg-ink-800 mx-auto" />
            </div>
          ) : failed && !release ? (
            <div className="mx-auto mt-8 max-w-xl rounded-panel border border-danger/25 bg-danger/10 p-6 text-center animate-fade-up">
              <p className="text-mini text-ink-100">{t.failed}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="rounded-btn border border-ink-600 px-4 py-2 text-mini font-medium text-ink-100 transition hover:border-ink-400 active:scale-[0.98]"
                >
                  {t.retry}
                </button>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-btn bg-lime-flash px-4 py-2 text-mini font-bold text-ink-950 transition hover:bg-lime-soft active:scale-[0.98]"
                >
                  {t.viewAll}
                </a>
              </div>
            </div>
          ) : (
            <section
              aria-label={t.title}
              className="mx-auto mt-8 max-w-xl animate-fade-up [animation-delay:180ms]"
            >
              <div className="relative overflow-hidden rounded-panel border border-lime-flash/30 bg-gradient-to-b from-lime-flash/[0.09] via-ink-900/90 to-ink-900/95 p-6 sm:p-7 shadow-2xl shadow-black/60 backdrop-blur-md">
                {/* Platform detection badge */}
                <div className="flex items-center justify-between gap-3 pb-5 border-b border-ink-800/80">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lime-flash text-lime-ink shadow-md shadow-lime-flash/20">
                      <PrimaryIcon className="size-5" strokeWidth={2.25} />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-body font-bold text-ink-100">{detectedOsName}</span>
                        <span className="rounded-full bg-lime-flash/20 px-2 py-0.5 text-micro font-semibold text-lime-flash">
                          {t.yourPlatform}
                        </span>
                      </div>
                      <p className="text-mini text-ink-400">
                        {activeVariant?.label ?? detectedOsName}
                      </p>
                    </div>
                  </div>

                  {release && (
                    <span className="hidden sm:inline-block text-micro font-mono text-ink-400 bg-ink-800/60 px-2.5 py-1 rounded-ctl border border-ink-700/50">
                      v{release.version}
                    </span>
                  )}
                </div>

                {/* Primary Download Button */}
                <div className="mt-5">
                  {isAvailable && activeDownloadUrl ? (
                    <a
                      href={activeDownloadUrl}
                      aria-label={
                        activeVariant?.file
                          ? t.downloadFor(activeVariant.file)
                          : t.downloadForPlatform(detectedOsName)
                      }
                      className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-btn bg-lime-flash px-5 py-4 text-ink-950 font-bold transition duration-200 hover:bg-lime-soft active:scale-[0.99] shadow-lg shadow-lime-flash/25"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-ctl bg-ink-950/10 transition-transform duration-200 group-hover:-translate-y-0.5">
                          <Download className="size-5 text-ink-950" strokeWidth={2.5} />
                        </span>
                        <div className="min-w-0 text-start">
                          <div className="text-body font-bold leading-tight">
                            {t.downloadForPlatform(detectedOsName)}
                          </div>
                          {activeVariant?.file && (
                            <div
                              dir="ltr"
                              className="text-micro font-mono font-medium text-ink-950/75 truncate mt-0.5"
                            >
                              {activeVariant.file}
                            </div>
                          )}
                        </div>
                      </div>

                      {activeVariant?.ext && (
                        <span className="shrink-0 rounded-md bg-ink-950/15 px-2.5 py-1 text-mini font-mono font-semibold text-ink-950">
                          {activeVariant.ext}
                        </span>
                      )}
                    </a>
                  ) : (
                    <a
                      href={RELEASES_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-btn border border-ink-700 bg-ink-800 px-5 py-4 text-ink-100 font-bold transition duration-200 hover:border-lime-flash/50 hover:bg-ink-750 active:scale-[0.99]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-ctl bg-ink-700 text-ink-200">
                          <ExternalLink className="size-5" />
                        </span>
                        <div className="min-w-0 text-start">
                          <div className="text-body font-bold leading-tight">{t.viewAll}</div>
                          <div className="text-micro text-ink-400 truncate mt-0.5">
                            {activeVariant?.label} not packaged in v{release?.version}
                          </div>
                        </div>
                      </div>
                      <ExternalLink className="size-4 text-ink-400 shrink-0" />
                    </a>
                  )}
                </div>

                {/* Architecture Selector for Detected OS */}
                {osVariants.length > 1 && (
                  <div className="mt-4 pt-4 border-t border-ink-800/60">
                    <p className="text-micro font-semibold uppercase tracking-wider text-ink-400 mb-2">
                      {t.otherOptionsFor(detectedOsName)}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {osVariants.map((variant) => {
                        const isSelected = activeVariant?.id === variant.id
                        return (
                          <button
                            key={variant.id}
                            type="button"
                            onClick={() => setSelectedVariant(variant.id)}
                            className={clsx(
                              'flex flex-col items-start rounded-ctl p-2 text-start transition text-mini relative',
                              isSelected
                                ? 'bg-lime-flash/15 border border-lime-flash/40 text-lime-flash shadow-sm'
                                : 'bg-ink-800/60 border border-ink-700/60 text-ink-300 hover:bg-ink-800 hover:text-ink-100',
                            )}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-semibold">{variant.label}</span>
                              {!variant.available && (
                                <span className="text-[10px] text-ink-400">N/A</span>
                              )}
                            </div>
                            <span className="text-micro text-ink-400 font-mono mt-0.5">
                              {variant.detail}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Memorable Desktop App Showcase Frame */}
          <section className="mt-12 sm:mt-14 animate-fade-up [animation-delay:240ms]">
            <DesktopAppShowcase />
          </section>
          {/* Features Highlights Grid */}
          <section className="mt-14 sm:mt-16">
            <div className="text-center mb-8">
              <h2 className="font-display text-2xl font-bold tracking-tight text-ink-100">
                {t.featuresTitle}
              </h2>
              <p className="mt-2 text-mini text-ink-300">{t.featuresSubtitle}</p>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {/* Feature 1 */}
              <div className="rounded-btn border border-ink-800 bg-ink-900/70 p-5 transition hover:border-ink-700">
                <span className="grid size-10 place-items-center rounded-xl bg-lime-flash/10 text-lime-flash mb-3.5">
                  <ShieldCheck className="size-5" />
                </span>
                <h3 className="font-display text-body font-bold text-ink-100">
                  {t.featureLocalTitle}
                </h3>
                <p className="mt-1.5 text-mini leading-relaxed text-ink-300">
                  {t.featureLocalDesc}
                </p>
              </div>

              {/* Feature 2 */}
              <div className="rounded-btn border border-ink-800 bg-ink-900/70 p-5 transition hover:border-ink-700">
                <span className="grid size-10 place-items-center rounded-xl bg-lime-flash/10 text-lime-flash mb-3.5">
                  <Zap className="size-5" />
                </span>
                <h3 className="font-display text-body font-bold text-ink-100">
                  {t.featureAudioTitle}
                </h3>
                <p className="mt-1.5 text-mini leading-relaxed text-ink-300">
                  {t.featureAudioDesc}
                </p>
              </div>

              {/* Feature 3 */}
              <div className="rounded-btn border border-ink-800 bg-ink-900/70 p-5 transition hover:border-ink-700">
                <span className="grid size-10 place-items-center rounded-xl bg-lime-flash/10 text-lime-flash mb-3.5">
                  <Music className="size-5" />
                </span>
                <h3 className="font-display text-body font-bold text-ink-100">
                  {t.featureLyricsTitle}
                </h3>
                <p className="mt-1.5 text-mini leading-relaxed text-ink-300">
                  {t.featureLyricsDesc}
                </p>
              </div>

              {/* Feature 4 */}
              <div className="rounded-btn border border-ink-800 bg-ink-900/70 p-5 transition hover:border-ink-700">
                <span className="grid size-10 place-items-center rounded-xl bg-lime-flash/10 text-lime-flash mb-3.5">
                  <FolderOpen className="size-5" />
                </span>
                <h3 className="font-display text-body font-bold text-ink-100">
                  {t.featurePlayerTitle}
                </h3>
                <p className="mt-1.5 text-mini leading-relaxed text-ink-300">
                  {t.featurePlayerDesc}
                </p>
              </div>
            </div>
          </section>

          {/* All Platforms & Packages Matrix */}
          {release && (
            <section className="mt-14 sm:mt-16">
              <div className="text-center mb-8">
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink-100">
                  {t.allPlatformsTitle}
                </h2>
                <p className="mt-2 text-mini text-ink-300">{t.allPlatformsSubtitle}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {allPlatforms.map((platform) => {
                  const PlatformIcon = platform.icon
                  const isCurrentOs = platform.id === detectedOs

                  return (
                    <div
                      key={platform.id}
                      className={clsx(
                        'flex flex-col rounded-panel border p-5 transition',
                        isCurrentOs
                          ? 'border-lime-flash/30 bg-ink-900/90 shadow-lg shadow-black/40'
                          : 'border-ink-800 bg-ink-900/60 hover:border-ink-700',
                      )}
                    >
                      {/* Platform Card Header */}
                      <div className="flex items-center justify-between pb-4 border-b border-ink-800/80">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={clsx(
                              'grid size-9 place-items-center rounded-ctl',
                              isCurrentOs
                                ? 'bg-lime-flash text-lime-ink'
                                : 'border border-ink-700 bg-ink-800 text-ink-200',
                            )}
                          >
                            <PlatformIcon className="size-4.5" strokeWidth={2} />
                          </span>
                          <span className="text-body font-bold text-ink-100">{platform.name}</span>
                        </div>

                        {isCurrentOs && (
                          <span className="rounded-full bg-lime-flash/20 px-2 py-0.5 text-micro font-semibold text-lime-flash">
                            {t.yourPlatform}
                          </span>
                        )}
                      </div>

                      {/* Platform Architectures & Download Links */}
                      <div className="mt-4 flex-1 space-y-4">
                        {platform.archs.map((arch) => (
                          <div key={arch.title} className="space-y-2">
                            <div>
                              <p className="text-mini font-semibold text-ink-200">{arch.title}</p>
                              <p className="text-micro text-ink-400">{arch.subtitle}</p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {arch.links.map((link) => {
                                const url = pick(link.name)
                                if (!link.available || !url) {
                                  return (
                                    <span
                                      key={link.name}
                                      className="inline-flex items-center gap-1 rounded-ctl border border-ink-800/80 bg-ink-900/40 px-2.5 py-1 text-micro text-ink-500 line-through"
                                      title="Not available in this release"
                                    >
                                      {link.label}
                                    </span>
                                  )
                                }

                                return (
                                  <a
                                    key={link.name}
                                    href={url}
                                    aria-label={t.downloadFor(link.name)}
                                    className="group inline-flex items-center gap-1.5 rounded-ctl border border-ink-700/80 bg-ink-800/60 px-3 py-1.5 text-mini font-medium text-ink-200 transition hover:border-lime-flash/50 hover:bg-ink-800 hover:text-lime-flash active:scale-[0.98]"
                                  >
                                    <Download className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5" />
                                    <span dir="ltr">{link.label}</span>
                                  </a>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* macOS Gatekeeper Terminal Guide */}
          <section className="mt-14 sm:mt-16">
            <div className="rounded-panel border border-ink-800 bg-ink-900/80 overflow-hidden shadow-xl">
              {/* Card Header with Collapsible Toggle */}
              <button
                type="button"
                onClick={() => setShowMacGuide((prev) => !prev)}
                className="w-full flex items-center justify-between p-5 text-start transition hover:bg-ink-800/40"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-ctl bg-ink-800 text-ink-200">
                    <Apple className="size-4.5" />
                  </span>
                  <div>
                    <h2 className="font-display text-body font-bold text-ink-100">
                      {t.macStepsTitle}
                    </h2>
                    <p className="text-mini text-ink-400">{t.macStepsSubtitle}</p>
                  </div>
                </div>

                <span className="grid size-7 place-items-center rounded-ctl border border-ink-700 text-ink-300">
                  {showMacGuide ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </span>
              </button>

              {/* Terminal View */}
              {showMacGuide && (
                <div className="border-t border-ink-800 p-5 sm:p-6 space-y-4 bg-ink-950/60 animate-fade-up">
                  {/* Step 1 */}
                  <div className="flex items-start gap-3 rounded-btn border border-ink-800 bg-ink-900/90 p-4">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-lime-flash text-micro font-bold text-ink-950">
                      1
                    </span>
                    <p className="text-mini leading-relaxed text-ink-300 pt-0.5">
                      {t.macStepInstall}
                    </p>
                  </div>

                  {/* Step 2: Terminal Command */}
                  <div className="rounded-btn border border-ink-800 bg-ink-900/90 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-ink-800/80 bg-black/40">
                      <div className="flex items-center gap-1.5" aria-hidden="true">
                        <span className="size-2.5 rounded-full bg-[#ff5f56]" />
                        <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
                        <span className="size-2.5 rounded-full bg-[#27c93f]" />
                        <span className="ms-2 font-mono text-[11px] text-ink-400">
                          Terminal — zsh
                        </span>
                      </div>
                      <CopyButton text={MAC_QUARANTINE_CMD} label={t.copy} copiedLabel={t.copied} />
                    </div>
                    <div
                      dir="ltr"
                      className="p-4 font-mono text-mini text-ink-100 overflow-x-auto bg-black/60 select-all"
                    >
                      <span className="text-lime-flash select-none me-2 font-bold">$ </span>
                      <code>{MAC_QUARANTINE_CMD}</code>
                    </div>
                  </div>

                  {/* Step 3: Resign if damaged */}
                  <div className="space-y-2">
                    <p className="text-mini text-ink-300 ps-1">{t.macStepResign}</p>
                    <div className="rounded-btn border border-ink-800 bg-ink-900/90 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-ink-800/80 bg-black/40">
                        <span className="font-mono text-[11px] text-ink-400">
                          Code sign fallback
                        </span>
                        <CopyButton text={MAC_RESIGN_CMD} label={t.copy} copiedLabel={t.copied} />
                      </div>
                      <div
                        dir="ltr"
                        className="p-4 font-mono text-mini text-ink-100 overflow-x-auto bg-black/60 select-all"
                      >
                        <span className="text-lime-flash select-none me-2 font-bold">$ </span>
                        <code>{MAC_RESIGN_CMD}</code>
                      </div>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex items-start gap-3 rounded-btn border border-ink-800 bg-ink-900/90 p-4">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-lime-flash text-micro font-bold text-ink-950">
                      2
                    </span>
                    <p className="text-mini leading-relaxed text-ink-300 pt-0.5">{t.macStepOpen}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* GitHub releases & verification footer */}
          <div className="mt-12 text-center space-y-3">
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-mini font-medium text-ink-300 underline decoration-ink-600 underline-offset-4 transition hover:text-lime-flash hover:decoration-lime-flash/60"
              >
                {t.viewAll}
                <ExternalLink className="size-3.5" />
              </a>

              {(failed || (release && !release.live)) && (
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="inline-flex items-center gap-1.5 rounded-ctl border border-ink-700 bg-ink-900 px-3 py-1 text-mini font-medium text-ink-200 transition hover:border-ink-500 hover:text-ink-100 active:scale-95"
                >
                  <RefreshCw className="size-3.5" />
                  {t.retry}
                </button>
              )}
            </div>
          </div>
        </main>

        {/* Site Footer */}
        <footer className="mx-auto w-full max-w-4xl px-5 py-6 border-t border-ink-800/60">
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
  )
}

export default function DownloadPage() {
  return (
    <LocaleProvider>
      <Shell />
    </LocaleProvider>
  )
}
