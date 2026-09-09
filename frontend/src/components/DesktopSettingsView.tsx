import { useEffect, useState } from 'react'
import { Cookie, FolderOpen, Globe2, RefreshCw, SlidersHorizontal, Sparkles } from 'lucide-react'
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
  installUpdateAndRelaunch,
  listInstalledBrowsers,
  openFolder,
  pickDownloadsDir,
  setCookiesFromBrowser,
  type DesktopInfo,
} from '../lib/desktop'
import { useMessages } from '../lib/i18n'

/** Mirrors BROWSER_ALLOWLIST in backend/app/ytdlp.py. Labels are product
 *  names, identical in both languages. */
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

export function DesktopSettingsView() {
  const m = useMessages()
  const [downloadsDir, setDownloadsDir] = useState('')
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; body: string } | null>(
    null,
  )
  const [cookiesBrowser, setCookiesBrowser] = useState('')
  const [cookiesNote, setCookiesNote] = useState<'saved' | 'failed' | null>(null)
  // null while the shell is still looking; [] genuinely means none found.
  const [installedBrowsers, setInstalledBrowsers] = useState<string[] | null>(null)

  useEffect(() => {
    getDownloadsDir().then(setDownloadsDir)
    getDesktopInfo().then(setInfo)
    listInstalledBrowsers().then(setInstalledBrowsers)
    getBackendDesktopConfig().then((config) => {
      if (config?.cookies_from_browser) setCookiesBrowser(config.cookies_from_browser)
    })
  }, [])

  // Only browsers that are actually here. A saved choice we failed to
  // detect stays listed anyway — dropping it would silently change a
  // setting the person made, and the detection is a heuristic, not proof.
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
    try {
      await installUpdateAndRelaunch()
    } catch {
      setUpdateStatus(m.settings.updateFailed)
    } finally {
      setInstalling(false)
    }
  }

  const card =
    'rounded-[14px] border border-white/[0.065] bg-white/[0.025] shadow-[0_10px_30px_rgba(0,0,0,0.1)]'
  const cardHeading =
    'flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400'

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-[#10130f]">
      <header className="shrink-0 border-b border-white/[0.055] bg-[#10130f]/95 px-7 pb-4 pt-5 backdrop-blur-xl">
        <div className="mx-auto max-w-[62rem]">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-flash/75">
            {m.desktopNav.desktopAppEyebrow}
          </p>
          <h1 className="font-display text-[22px] font-bold tracking-[-0.025em] text-ink-100">
            {m.desktopNav.settings}
          </h1>
          <p className="mt-1 text-xs text-ink-500">{m.desktopNav.settingsDescription}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
        <div className="mx-auto grid max-w-[62rem] grid-cols-1 gap-3 lg:grid-cols-2">
          <section className={clsx(card, 'p-4')}>
            <h2 className={cardHeading}>
              <SlidersHorizontal className="size-3.5 text-lime-flash" />
              {m.desktopNav.audioDefaults}
            </h2>
            <p className="mt-1.5 text-[11px] leading-5 text-ink-500">
              {m.desktopNav.audioDefaultsHint}
            </p>
            <div className="mt-4 space-y-3.5">
              <div className="flex min-h-10 items-center justify-between gap-4 rounded-[10px] border border-white/[0.05] bg-black/15 px-3">
                <QualityPicker className="w-full justify-between" />
              </div>
              <div className="flex min-h-10 items-center justify-between gap-4 rounded-[10px] border border-white/[0.05] bg-black/15 px-3">
                <LyricsToggle className="w-full justify-between" />
              </div>
            </div>
          </section>

          <section className={clsx(card, 'p-4')}>
            <h2 className={cardHeading}>
              <Globe2 className="size-3.5 text-lime-flash" />
              {m.language.label}
            </h2>
            <p className="mt-1.5 text-[11px] leading-5 text-ink-500">{m.desktopNav.languageHint}</p>
            <div className="mt-4 flex min-h-10 items-center rounded-[10px] border border-white/[0.05] bg-black/15 px-3">
              <LanguagePicker className="w-full justify-between" />
            </div>
          </section>

          <section className={clsx(card, 'p-4 lg:col-span-2')}>
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className={cardHeading}>
                  <FolderOpen className="size-3.5 text-lime-flash" />
                  {m.settings.downloadsFolder}
                </h2>
                <p className="mt-1.5 text-[11px] leading-5 text-ink-500">
                  {m.desktopNav.downloadsFolderHint}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => downloadsDir && openFolder(downloadsDir)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.035] px-2.5 text-[11px] font-semibold text-ink-300 transition hover:bg-white/[0.07] hover:text-ink-100"
                >
                  <FolderOpen className="size-3 text-lime-flash" />
                  {m.settings.openInFinder}
                </button>
                <button
                  type="button"
                  onClick={handlePickFolder}
                  className="h-8 rounded-lg bg-lime-flash px-3 text-[11px] font-bold text-lime-ink transition hover:bg-lime-soft active:scale-95"
                >
                  {m.settings.changeFolder}
                </button>
              </div>
            </div>
            <div className="mt-4 flex min-h-10 items-center rounded-[10px] border border-white/[0.055] bg-black/25 px-3 font-mono text-[11px] text-ink-400 selection:bg-lime-flash/20">
              {/* LTR: a leading "~" or "/" is direction-neutral, so the
                  Farsi page would otherwise reorder the path's segments. */}
              <span dir="ltr" className="min-w-0 break-all text-start">
                {downloadsDir || '...'}
              </span>
            </div>
          </section>

          <section className={clsx(card, 'p-4 lg:col-span-2')}>
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h2 className={cardHeading}>
                  <Cookie className="size-3.5 text-lime-flash" />
                  {m.cookies.title}
                </h2>
                <p className="mt-1.5 text-[11px] leading-5 text-ink-500">{m.cookies.hint}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {cookiesNote && (
                  <span
                    className={clsx(
                      'text-[11px] font-medium',
                      cookiesNote === 'saved' ? 'text-lime-flash' : 'text-danger',
                    )}
                  >
                    {cookiesNote === 'saved' ? m.cookies.saved : m.cookies.failed}
                  </span>
                )}
                {foundNone && (
                  <span className="text-[11px] text-ink-500">{m.cookies.noneFound}</span>
                )}
                <Dropdown
                  value={cookiesBrowser}
                  options={browserOptions}
                  onChange={(next) => void handleCookiesChange(next)}
                  label={m.cookies.title}
                  placeholder={m.cookies.off}
                  className="w-40"
                />
              </div>
            </div>
          </section>

          <section className={clsx(card, 'p-4 lg:col-span-2')}>
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0">
                <h2 className={cardHeading}>
                  <Sparkles className="size-3.5 text-lime-flash" />
                  {m.desktopNav.about}
                </h2>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  {info?.version ? m.settings.appVersion(info.version) : m.desktopNav.appName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {updateStatus && (
                  <span
                    className={clsx(
                      'text-[11px] font-medium',
                      updateAvailable ? 'text-lime-flash' : 'text-ink-500',
                    )}
                  >
                    {updateStatus}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.035] px-2.5 text-[11px] font-semibold text-ink-300 transition hover:bg-white/[0.07] hover:text-ink-100 disabled:opacity-50"
                >
                  <RefreshCw className={clsx('size-3', checkingUpdate && 'animate-spin')} />
                  {checkingUpdate ? m.settings.checkingUpdates : m.settings.checkUpdates}
                </button>
              </div>
            </div>

            {updateAvailable && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] border border-lime-flash/20 bg-lime-flash/[0.06] p-3 animate-fade-up">
                <p className="text-[11px] text-ink-300">
                  <span className="font-semibold text-lime-flash">{m.desktopNav.newVersion} </span>
                  {updateAvailable.version}
                </p>
                <button
                  type="button"
                  onClick={handleInstallUpdate}
                  disabled={installing}
                  className="h-7 rounded-md bg-lime-flash px-2.5 text-[10px] font-bold text-lime-ink transition hover:bg-lime-soft disabled:opacity-50"
                >
                  {installing ? m.settings.installing : m.settings.installUpdate}
                </button>
              </div>
            )}
          </section>

          {/* Inherits the document direction on purpose. This is a sentence
              — "built by X and Y" — so in Farsi it has to start on the
              right; pinning it to LTR left the phrase leading a line that
              reads the other way. The Latin handles inside still render
              LTR on their own, which is bidi doing its job. */}
          <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 py-3 text-[11px] text-ink-500 lg:col-span-2">
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

function Credit({ href, image, name }: { href: string; image: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 font-semibold text-ink-400 transition hover:text-lime-flash"
    >
      <img
        src={image}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-[18px] rounded-full object-cover ring-1 ring-white/15"
      />
      {name}
    </a>
  )
}
