import { useEffect, useState } from 'react'
import {
  Cookie,
  FolderOpen,
  Globe2,
  HardDrive,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import { Dropdown } from './Dropdown'
import { LanguagePicker } from './LanguagePicker'
import { LyricsToggle } from './LyricsToggle'
import { QualityPicker } from './QualityPicker'
import {
  checkForAppUpdates,
  getBackendDesktopConfig,
  getDesktopInfo,
  getDownloadsDir,
  downloadAndInstallUpdate,
  relaunchApp,
  listInstalledBrowsers,
  openFolder,
  pickDownloadsDir,
  setCookiesFromBrowser,
  type DesktopInfo,
} from '../lib/desktop'
import { useMessages } from '../lib/i18n'

const COOKIE_BROWSERS = [
  { value: 'chrome', label: 'Google Chrome' },
  { value: 'brave', label: 'Brave' },
  { value: 'edge', label: 'Microsoft Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'safari', label: 'Safari' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'opera', label: 'Opera' },
  { value: 'vivaldi', label: 'Vivaldi' },
] as const

function Credit({ href, image, name }: { href: string; image: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-micro font-medium text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash"
    >
      <img src={image} alt="" className="size-4 rounded-full object-cover" />
      <span dir="ltr">{name}</span>
    </a>
  )
}

export function DesktopSettingsView() {
  const m = useMessages()
  const [downloadsDir, setDownloadsDir] = useState('')
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; body: string } | null>(
    null,
  )
  const [cookiesBrowser, setCookiesBrowser] = useState('')
  const [cookiesNote, setCookiesNote] = useState<'saved' | 'failed' | null>(null)
  const [installedBrowsers, setInstalledBrowsers] = useState<string[] | null>(null)

  useEffect(() => {
    getDownloadsDir().then(setDownloadsDir)
    getDesktopInfo().then(setInfo)
    listInstalledBrowsers().then(setInstalledBrowsers)
    getBackendDesktopConfig().then((config) => {
      if (config?.cookies_from_browser) setCookiesBrowser(config.cookies_from_browser)
    })
  }, [])

  const browserOptions = [
    { value: '', label: m.cookies.off },
    ...COOKIE_BROWSERS.filter(
      (browser) =>
        installedBrowsers === null ||
        installedBrowsers.includes(browser.value) ||
        browser.value === cookiesBrowser,
    ).map((browser) => ({ value: browser.value, label: browser.label })),
  ]
  const foundNone = installedBrowsers !== null && browserOptions.length === 1

  const handleCookiesChange = async (value: string) => {
    setCookiesBrowser(value)
    setCookiesNote(null)
    const ok = await setCookiesFromBrowser(value)
    setCookiesNote(ok ? 'saved' : 'failed')
  }

  const handlePickFolder = async () => {
    const picked = await pickDownloadsDir()
    if (picked) setDownloadsDir(picked)
  }

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateStatus(null)
    setUpdateAvailable(null)
    setUpdateReady(false)
    try {
      const result = await checkForAppUpdates()
      if (result?.available && result.version) {
        setUpdateStatus(m.settings.updateAvailable(result.version))
        setUpdateAvailable({ version: result.version, body: result.body ?? '' })
      } else {
        setUpdateStatus(m.settings.upToDate)
      }
    } catch {
      setUpdateStatus(null)
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleInstallUpdate = async () => {
    setInstalling(true)
    setUpdateStatus(null)
    try {
      const ok = await downloadAndInstallUpdate()
      if (ok) {
        setUpdateReady(true)
        setUpdateStatus(m.settings.updateReady)
      } else {
        setUpdateStatus(m.settings.updateFailed)
      }
    } catch {
      setUpdateStatus(m.settings.updateFailed)
    } finally {
      setInstalling(false)
    }
  }

  const handleRelaunch = async () => {
    setRestarting(true)
    try {
      await relaunchApp()
    } catch {
      setRestarting(false)
    }
  }

  const card =
    'rounded-panel border border-white/[0.08] bg-ink-900/70 p-5 sm:p-6 shadow-lg backdrop-blur-sm transition hover:border-white/[0.12]'
  const cardHeading =
    'flex items-center gap-2 text-micro font-bold uppercase tracking-wider text-ink-300'

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-ink-950">
      {/* Settings Header */}
      <header className="shrink-0 border-b border-white/[0.06] bg-ink-950/90 px-6 sm:px-8 py-5 backdrop-blur-xl">
        <div className="mx-auto max-w-4xl">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-100">
            {m.desktopNav.settings}
          </h1>
          <p className="mt-1 text-mini text-ink-400">{m.desktopNav.settingsDescription}</p>
        </div>
      </header>

      {/* Settings Cards Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-8 py-6">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Audio Defaults Card */}
          <section className={card}>
            <h2 className={cardHeading}>
              <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
                <SlidersHorizontal className="size-4" />
              </span>
              <span>{m.desktopNav.audioDefaults}</span>
            </h2>
            <p className="mt-2 text-mini text-ink-400">{m.desktopNav.audioDefaultsHint}</p>
            <div className="mt-4 space-y-3">
              <div className="flex min-h-11 items-center justify-between gap-4 rounded-ctl border border-white/[0.07] bg-black/30 px-3.5">
                <QualityPicker className="w-full justify-between" />
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 rounded-ctl border border-white/[0.07] bg-black/30 px-3.5">
                <LyricsToggle className="w-full justify-between" />
              </div>
            </div>
          </section>

          {/* Interface & Language Card */}
          <section className={card}>
            <h2 className={cardHeading}>
              <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
                <Globe2 className="size-4" />
              </span>
              <span>{m.language.label}</span>
            </h2>
            <p className="mt-2 text-mini text-ink-400">{m.desktopNav.languageHint}</p>
            <div className="mt-4 flex min-h-11 items-center rounded-ctl border border-white/[0.07] bg-black/30 px-3.5">
              <LanguagePicker className="w-full justify-between" />
            </div>
          </section>

          {/* Downloads Directory Card */}
          <section className={clsx(card, 'lg:col-span-2')}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className={cardHeading}>
                  <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
                    <FolderOpen className="size-4" />
                  </span>
                  <span>{m.settings.downloadsFolder}</span>
                </h2>
                <p className="mt-2 text-mini text-ink-400">{m.desktopNav.downloadsFolderHint}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadsDir && openFolder(downloadsDir)}
                  className="flex h-8.5 items-center gap-1.5 rounded-ctl border border-white/[0.08] bg-white/[0.03] px-3 text-mini font-medium text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash active:scale-95"
                >
                  <FolderOpen className="size-3.5 text-lime-flash" />
                  <span>{m.settings.openInFinder}</span>
                </button>
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="h-8.5 rounded-btn bg-lime-flash px-3.5 text-mini font-bold text-ink-950 transition hover:bg-lime-soft active:scale-95 shadow-sm"
                >
                  {m.settings.changeFolder}
                </button>
              </div>
            </div>
            <div className="mt-4 flex min-h-11 items-center rounded-ctl border border-white/[0.07] bg-black/40 px-3.5 font-mono text-mini text-ink-300">
              <HardDrive className="size-4 text-ink-500 me-2.5 shrink-0" />
              <span dir="ltr" className="min-w-0 break-all text-start">
                {downloadsDir || '...'}
              </span>
            </div>
          </section>

          {/* YouTube Cookies Integration Card */}
          <section className={clsx(card, 'lg:col-span-2 relative z-20')}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-lg">
                <h2 className={cardHeading}>
                  <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
                    <Cookie className="size-4" />
                  </span>
                  <span>{m.cookies.title}</span>
                </h2>
                <p className="mt-2 text-mini leading-relaxed text-ink-400">{m.cookies.hint}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {cookiesNote && (
                  <span
                    className={clsx(
                      'text-mini font-semibold',
                      cookiesNote === 'saved' ? 'text-lime-flash' : 'text-danger',
                    )}
                  >
                    {cookiesNote === 'saved' ? m.cookies.saved : m.cookies.failed}
                  </span>
                )}
                {foundNone && <span className="text-mini text-ink-500">{m.cookies.noneFound}</span>}
                <Dropdown
                  value={cookiesBrowser}
                  options={browserOptions}
                  onChange={(next) => void handleCookiesChange(next)}
                  label={m.cookies.title}
                  placeholder={m.cookies.off}
                  className="w-44"
                />
              </div>
            </div>
          </section>

          {/* App Info & Software Updates Card */}
          <section className={clsx(card, 'lg:col-span-2 relative z-10')}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className={cardHeading}>
                  <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
                    <Sparkles className="size-4" />
                  </span>
                  <span>{m.desktopNav.about}</span>
                </h2>
                <p className="mt-2 text-mini text-ink-400">
                  {info?.version ? m.settings.appVersion(info.version) : m.desktopNav.appName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {updateStatus && (
                  <span
                    className={clsx(
                      'text-mini font-medium',
                      updateAvailable ? 'text-lime-flash' : 'text-ink-400',
                    )}
                  >
                    {updateStatus}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="flex h-8.5 items-center gap-1.5 rounded-ctl border border-white/[0.08] bg-white/[0.03] px-3 text-mini font-medium text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash disabled:opacity-50 active:scale-95"
                >
                  <RefreshCw className={clsx('size-3.5', checkingUpdate && 'animate-spin')} />
                  <span>
                    {checkingUpdate ? m.settings.checkingUpdates : m.settings.checkUpdates}
                  </span>
                </button>
              </div>
            </div>

            {updateReady ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-lime-flash/40 bg-lime-flash/10 p-3.5 animate-fade-up">
                <p className="text-mini font-semibold text-lime-flash">{m.settings.updateReady}</p>
                <button
                  type="button"
                  onClick={handleRelaunch}
                  disabled={restarting}
                  className="flex h-8.5 items-center gap-1.5 rounded-ctl bg-lime-flash px-4 text-mini font-bold text-ink-950 transition hover:bg-lime-soft active:scale-95 disabled:opacity-50 shadow-md shadow-lime-flash/20"
                >
                  <RotateCcw className={clsx('size-3.5', restarting && 'animate-spin')} />
                  <span>{m.settings.restartApp}</span>
                </button>
              </div>
            ) : updateAvailable ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-lime-flash/30 bg-lime-flash/[0.08] p-3.5 animate-fade-up">
                <p className="text-mini text-ink-200">
                  <span className="font-bold text-lime-flash">{m.desktopNav.newVersion} </span>
                  <span className="tabular-nums font-semibold">{updateAvailable.version}</span>
                </p>
                <button
                  type="button"
                  onClick={handleInstallUpdate}
                  disabled={installing}
                  className="flex h-8.5 items-center gap-1.5 rounded-ctl bg-lime-flash px-4 text-mini font-bold text-ink-950 transition hover:bg-lime-soft disabled:opacity-50 shadow-sm"
                >
                  {installing && <RefreshCw className="size-3.5 animate-spin" />}
                  <span>{installing ? m.settings.installing : m.settings.installUpdate}</span>
                </button>
              </div>
            ) : null}
          </section>

          {/* Built by credits */}
          <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 py-4 text-mini text-ink-500 lg:col-span-2">
            <span>{m.desktopNav.builtBy}</span>
            <Credit href="https://x.com/_amiralibgi" image="/amirali.jpg" name="amiralibgi" />
            <span>{m.desktopNav.and}</span>
            <Credit href="https://x.com/yazdanctx" image="/yazdan.jpg" name="yazdanctx" />
          </footer>
        </div>
      </div>
    </div>
  )
}
