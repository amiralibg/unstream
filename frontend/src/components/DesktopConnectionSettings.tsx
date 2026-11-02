import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, Check, Cookie, LoaderCircle, Network, Radar, TriangleAlert } from 'lucide-react'
import clsx from 'clsx'
import { Dropdown } from './Dropdown'
import {
  detectProxies,
  getBackendDesktopConfig,
  isWindows,
  listInstalledBrowsers,
  runDiagnosis,
  setCookiesFromBrowser,
  setProxy,
  type CookieStatus,
  type DetectedProxies,
  type Diagnosis,
  type ServiceCheck,
} from '../lib/desktop'
import { useMessages } from '../lib/i18n'
import type { Messages } from '../lib/locales/en'

export const settingsCard =
  'rounded-panel border border-fg/[0.08] bg-ink-900/70 p-5 sm:p-6 shadow-lg backdrop-blur-sm transition hover:border-fg/[0.12]'
export const settingsCardHeading =
  'flex items-center gap-2 text-micro font-bold uppercase tracking-wider text-ink-300'

const quietButton =
  'flex h-8.5 items-center gap-1.5 rounded-ctl border border-fg/[0.08] bg-fg/[0.03] px-3 text-mini font-medium text-ink-300 transition hover:border-lime-flash/40 hover:text-lime-flash disabled:opacity-50 active:scale-95'

const COOKIE_BROWSERS = [
  { value: 'firefox', label: 'Firefox' },
  { value: 'chrome', label: 'Google Chrome' },
  { value: 'brave', label: 'Brave' },
  { value: 'edge', label: 'Microsoft Edge' },
  { value: 'safari', label: 'Safari' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'opera', label: 'Opera' },
  { value: 'vivaldi', label: 'Vivaldi' },
] as const

const CHROMIUM_FAMILY = new Set(['chrome', 'chromium', 'brave', 'edge', 'opera', 'vivaldi'])

const browserLabel = (id: string) => COOKIE_BROWSERS.find((b) => b.value === id)?.label ?? id

type Tone = 'ok' | 'warn' | 'error'

/** One sentence (and, when it is broken, what to do about it) for a cookie
 *  store read. A store that opened but decrypted nothing is treated as
 *  unreadable: that is Chrome's app-bound encryption on Windows, and "not
 *  signed in" would send the person off to sign in to a browser they are
 *  already signed in to. */
function describeCookies(
  status: CookieStatus,
  m: Messages,
): { tone: Tone; text: string; help?: string } {
  const name = browserLabel(status.browser)
  if (status.ok && status.signed_in) return { tone: 'ok', text: m.cookies.signedIn(name) }
  if (status.ok && !status.error) return { tone: 'warn', text: m.cookies.notSignedIn(name) }
  const help =
    status.browser === 'safari'
      ? m.cookies.unreadableSafari
      : isWindows() && CHROMIUM_FAMILY.has(status.browser)
        ? m.cookies.unreadableWindowsChromium
        : m.cookies.unreadableOther
  return { tone: 'error', text: m.cookies.unreadable(name), help }
}

const toneText: Record<Tone, string> = {
  ok: 'text-lime-flash',
  warn: 'text-ink-100',
  error: 'text-danger',
}

const toneDot: Record<Tone, string> = {
  ok: 'bg-lime-flash',
  warn: 'bg-ink-300',
  error: 'bg-danger',
}

type Mode = 'system' | 'custom' | 'off'

const modeOf = (setting: string): Mode =>
  setting === 'system' || setting === 'off' ? setting : 'custom'

/** Proxy URLs are shown as typed, so the scheme the backend normalised to
 *  (socks5h) reads as the one people know. */
const displayProxy = (url: string) => url.replace(/^socks5h:\/\//, 'socks5://')

function StatusRow({
  label,
  sublabel,
  tone,
  value,
}: {
  label: string
  sublabel?: string
  tone: Tone | 'muted'
  value: ReactNode
}) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-4 px-3.5 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={clsx(
            'size-2 shrink-0 rounded-full',
            tone === 'muted' ? 'bg-ink-600' : toneDot[tone],
          )}
        />
        <div className="min-w-0">
          <p className="truncate text-mini font-semibold text-ink-100">{label}</p>
          {sublabel && <p className="truncate text-micro text-ink-500">{sublabel}</p>}
        </div>
      </div>
      <span
        className={clsx(
          'shrink-0 text-end text-micro font-medium',
          tone === 'muted' ? 'text-ink-500' : toneText[tone],
        )}
      >
        {value}
      </span>
    </li>
  )
}

function tipFor(diagnosis: Diagnosis, m: Messages): string | null {
  const failed = diagnosis.services.filter((s) => !s.ok)
  if (failed.length === 0) {
    const routed =
      diagnosis.proxy !== 'off' && (diagnosis.proxy !== 'system' || diagnosis.system_proxy)
    const youtubeOk = diagnosis.services.some((s) => s.id === 'youtube' && s.ok)
    return routed && youtubeOk && !diagnosis.cookies?.signed_in
      ? m.connection.tips.youtubeSignIn
      : null
  }
  if (failed.some((s) => s.error === 'proxy')) return m.connection.tips.proxyDown
  if (failed.every((s) => s.error === 'refused_by_service')) return m.connection.tips.serviceRefused
  if (diagnosis.proxy === 'system' && !diagnosis.system_proxy) return m.connection.tips.noRoute
  return m.connection.tips.generic
}

export function ConnectionCard({ autoCheck = false }: { autoCheck?: boolean }) {
  const m = useMessages()
  const cardRef = useRef<HTMLElement>(null)
  const [mode, setMode] = useState<Mode>('system')
  const [applied, setApplied] = useState('system')
  const [systemProxy, setSystemProxy] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState<DetectedProxies | null>(null)
  const [testing, setTesting] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [testFailed, setTestFailed] = useState(false)

  const test = useCallback(async () => {
    setTesting(true)
    setTestFailed(false)
    try {
      const result = await runDiagnosis()
      setDiagnosis(result)
      setSystemProxy(result.system_proxy)
    } catch {
      setTestFailed(true)
    } finally {
      setTesting(false)
    }
  }, [])

  useEffect(() => {
    getBackendDesktopConfig().then((config) => {
      if (!config) return
      setApplied(config.proxy)
      setMode(modeOf(config.proxy))
      setSystemProxy(config.system_proxy ?? null)
      if (modeOf(config.proxy) === 'custom') setDraft(displayProxy(config.proxy))
    })
    if (autoCheck) {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      void test()
    }
  }, [autoCheck, test])

  const apply = async (value: string) => {
    setSaving(true)
    setSaveError(null)
    setSavedFlash(false)
    try {
      const saved = await setProxy(value)
      setApplied(saved)
      setMode(modeOf(saved))
      if (modeOf(saved) === 'custom') setDraft(displayProxy(saved))
      setSavedFlash(true)
      void test()
    } catch (err) {
      // A message means the backend read the value and refused it; anything
      // else is the request itself failing.
      setSaveError(
        err instanceof Error && err.message ? m.connection.invalidProxy : m.errors.noAnswer,
      )
    } finally {
      setSaving(false)
    }
  }

  const chooseMode = (next: Mode) => {
    setMode(next)
    setSaveError(null)
    setSavedFlash(false)
    if (next !== 'custom' && next !== applied) void apply(next)
  }

  const detect = async () => {
    setDetecting(true)
    try {
      const result = await detectProxies()
      setDetected(result)
      setSystemProxy(result.system)
    } catch {
      setDetected({ found: [], system: null })
    } finally {
      setDetecting(false)
    }
  }

  const modes: Mode[] = ['system', 'custom', 'off']
  const okCount = diagnosis?.services.filter((s) => s.ok).length ?? 0
  const tip = diagnosis ? tipFor(diagnosis, m) : null

  const serviceValue = (check: ServiceCheck) =>
    check.ok ? (
      <span dir="ltr">{m.connection.ms(check.ms ?? 0)}</span>
    ) : (
      m.connection.failures[check.error ?? 'network']
    )

  return (
    <section
      ref={cardRef}
      className={clsx(settingsCard, 'relative z-30 scroll-mt-6 lg:col-span-2')}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-lg">
          <h2 className={settingsCardHeading}>
            <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
              <Network className="size-4" />
            </span>
            <span>{m.connection.title}</span>
          </h2>
          <p className="mt-2 text-mini leading-relaxed text-ink-400">{m.connection.hint}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={m.connection.modeLabel}
          className="flex h-9 shrink-0 items-center rounded-[10px] border border-fg/[0.065] bg-well/20 p-1"
        >
          {modes.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={mode === item}
              title={m.connection.modeHints[item]}
              onClick={() => chooseMode(item)}
              disabled={saving}
              className={clsx(
                'flex h-7 items-center rounded-[7px] px-3 text-[11px] font-semibold transition duration-150',
                mode === item
                  ? 'bg-fg/[0.09] text-ink-100 shadow-sm'
                  : 'text-ink-500 hover:text-ink-200',
              )}
            >
              {m.connection.modes[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <p className="text-micro text-ink-500">{m.connection.modeHints[mode]}</p>

        {mode === 'system' && (
          <div className="flex min-h-11 items-center gap-2 rounded-ctl border border-fg/[0.07] bg-well/30 px-3.5 text-mini text-ink-300">
            {systemProxy ? (
              <>
                <span className="text-ink-400">{m.connection.systemProxy}:</span>
                <span dir="ltr" className="truncate font-mono text-ink-200">
                  {systemProxy}
                </span>
              </>
            ) : (
              <span className="text-ink-400">{m.connection.noSystemProxy}</span>
            )}
          </div>
        )}

        {mode === 'custom' && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft.trim()) void apply(draft)
            }}
          >
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setSaveError(null)
                setSavedFlash(false)
              }}
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
              placeholder={m.connection.proxyPlaceholder}
              aria-label={m.connection.modes.custom}
              aria-invalid={saveError ? true : undefined}
              className={clsx(
                'h-11 min-w-0 flex-1 rounded-ctl border bg-well/30 px-3.5 font-mono text-mini text-ink-100 outline-none transition placeholder:text-ink-600 focus:border-lime-flash/50',
                saveError ? 'border-danger/50' : 'border-fg/[0.07]',
              )}
            />
            <button
              type="submit"
              disabled={saving || !draft.trim()}
              className="flex h-11 items-center gap-1.5 rounded-btn bg-lime-flash px-4 text-mini font-bold text-ink-950 shadow-sm transition hover:bg-lime-soft disabled:opacity-50 active:scale-95"
            >
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {m.connection.save}
            </button>
          </form>
        )}

        {(saveError || savedFlash) && (
          <p
            role={saveError ? 'alert' : 'status'}
            className={clsx(
              'text-mini font-semibold',
              saveError ? 'text-danger' : 'text-lime-flash',
            )}
          >
            {saveError ?? m.connection.saved}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={detect} disabled={detecting} className={quietButton}>
            {detecting ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Radar className="size-3.5 text-lime-flash" />
            )}
            {detecting ? m.connection.detecting : m.connection.detect}
          </button>
          <button type="button" onClick={test} disabled={testing} className={quietButton}>
            {testing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Activity className="size-3.5 text-lime-flash" />
            )}
            {testing ? m.connection.testing : m.connection.test}
          </button>
        </div>

        {detected && (
          <div className="animate-fade-up rounded-ctl border border-fg/[0.07] bg-well/20 p-3.5">
            {detected.found.length > 0 ? (
              <>
                <p className="text-micro font-semibold text-ink-400">{m.connection.detected}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {detected.found.map((url) => {
                    const inUse = applied === url
                    return (
                      <li key={url}>
                        <button
                          type="button"
                          onClick={() => !inUse && void apply(url)}
                          disabled={saving}
                          className={clsx(
                            'flex h-8 items-center gap-2 rounded-full border ps-3 pe-1 text-mini transition',
                            inUse
                              ? 'border-lime-flash/40 bg-lime-flash/10 text-lime-flash'
                              : 'border-fg/[0.08] bg-fg/[0.03] text-ink-200 hover:border-lime-flash/40',
                          )}
                        >
                          <span dir="ltr" className="font-mono">
                            {displayProxy(url)}
                          </span>
                          <span
                            className={clsx(
                              'flex h-6 items-center gap-1 rounded-full px-2.5 text-micro font-bold',
                              inUse ? 'text-lime-flash' : 'bg-lime-flash text-ink-950',
                            )}
                          >
                            {inUse && <Check className="size-3" />}
                            {inUse ? m.connection.inUse : m.connection.use}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <p className="text-mini leading-relaxed text-ink-400">{m.connection.noneDetected}</p>
            )}
          </div>
        )}

        {testFailed && <p className="text-mini text-danger">{m.errors.noAnswer}</p>}

        {diagnosis && (
          <div className="animate-fade-up overflow-hidden rounded-ctl border border-fg/[0.07] bg-well/20">
            <p
              className={clsx(
                'border-b border-fg/[0.05] px-3.5 py-2.5 text-mini font-semibold',
                okCount === diagnosis.services.length ? 'text-lime-flash' : 'text-ink-200',
              )}
            >
              {okCount === diagnosis.services.length
                ? m.connection.allGood
                : m.connection.someFailed(okCount, diagnosis.services.length)}
            </p>
            <ul className="divide-y divide-fg/[0.045]">
              {diagnosis.services.map((check) => (
                <StatusRow
                  key={check.id}
                  label={m.connection.services[check.id]}
                  sublabel={m.connection.serviceRole[check.id]}
                  tone={check.ok ? 'ok' : 'error'}
                  value={serviceValue(check)}
                />
              ))}
              {diagnosis.cookies ? (
                (() => {
                  const cookies = describeCookies(diagnosis.cookies, m)
                  return (
                    <StatusRow
                      label={m.connection.cookiesRow}
                      sublabel={browserLabel(diagnosis.cookies.browser)}
                      tone={cookies.tone}
                      value={cookies.tone === 'ok' ? <Check className="size-3.5" /> : cookies.text}
                    />
                  )
                })()
              ) : (
                <StatusRow
                  label={m.connection.cookiesRow}
                  tone="muted"
                  value={m.connection.cookiesOff}
                />
              )}
              <StatusRow
                label={m.connection.toolsRow}
                sublabel={diagnosis.tools.js_runtime ?? undefined}
                tone={diagnosis.tools.ffmpeg && diagnosis.tools.js_runtime ? 'ok' : 'error'}
                value={
                  !diagnosis.tools.ffmpeg
                    ? m.connection.ffmpegMissing
                    : !diagnosis.tools.js_runtime
                      ? m.connection.jsMissing
                      : m.connection.toolsOk
                }
              />
            </ul>
            {tip && (
              <p className="flex gap-2 border-t border-fg/[0.05] bg-fg/[0.025] px-3.5 py-3 text-mini leading-relaxed text-ink-200">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-ink-300" />
                <span>{tip}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

export function CookiesCard() {
  const m = useMessages()
  const [browser, setBrowser] = useState('')
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<CookieStatus | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    listInstalledBrowsers().then(setInstalled)
    getBackendDesktopConfig().then((config) => {
      if (config?.cookies_from_browser) setBrowser(config.cookies_from_browser)
    })
  }, [])

  const options = [
    { value: '', label: m.cookies.off },
    ...COOKIE_BROWSERS.filter(
      (b) => installed === null || installed.includes(b.value) || b.value === browser,
    ).map((b) => ({ value: b.value, label: b.label })),
  ]
  const foundNone = installed !== null && options.length === 1

  const choose = async (value: string) => {
    setBrowser(value)
    setStatus(null)
    setSaveFailed(false)
    setChecking(Boolean(value))
    const result = await setCookiesFromBrowser(value)
    setChecking(false)
    if (result === false) setSaveFailed(true)
    else setStatus(result)
  }

  const described = status ? describeCookies(status, m) : null

  return (
    <section className={clsx(settingsCard, 'relative z-20 lg:col-span-2')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-lg">
          <h2 className={settingsCardHeading}>
            <span className="grid size-7 place-items-center rounded-lg bg-lime-flash/10 text-lime-flash">
              <Cookie className="size-4" />
            </span>
            <span>{m.cookies.title}</span>
          </h2>
          <p className="mt-2 text-mini leading-relaxed text-ink-400">
            {m.cookies.hint} {m.cookies.recommended}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {foundNone && <span className="text-mini text-ink-500">{m.cookies.noneFound}</span>}
          <Dropdown
            value={browser}
            options={options}
            onChange={(next) => void choose(next)}
            label={m.cookies.title}
            placeholder={m.cookies.off}
            className="w-44"
          />
        </div>
      </div>

      {(checking || described || saveFailed) && (
        <div
          role="status"
          className="mt-4 flex gap-2.5 rounded-ctl border border-fg/[0.07] bg-well/20 px-3.5 py-3 animate-fade-up"
        >
          {checking ? (
            <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-ink-400" />
          ) : (
            <span
              className={clsx(
                'mt-1.5 size-2 shrink-0 rounded-full',
                saveFailed ? 'bg-danger' : toneDot[described!.tone],
              )}
            />
          )}
          <div className="min-w-0 text-mini leading-relaxed">
            <p
              className={clsx(
                'font-semibold',
                checking ? 'text-ink-300' : saveFailed ? 'text-danger' : toneText[described!.tone],
              )}
            >
              {checking ? m.cookies.checking : saveFailed ? m.cookies.failed : described!.text}
            </p>
            {!checking && described?.help && <p className="mt-1 text-ink-400">{described.help}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
