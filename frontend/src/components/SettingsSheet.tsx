import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { LanguagePicker } from './LanguagePicker'
import { LyricsToggle } from './LyricsToggle'
import { QualityPicker } from './QualityPicker'
import { Sheet } from './Sheet'
import { useMessages } from '../lib/i18n'
import {
  isDesktop,
  getDownloadsDir,
  pickDownloadsDir,
  getDesktopInfo,
  checkForAppUpdates,
  installUpdateAndRelaunch,
  type DesktopInfo,
  type UpdateProgress,
} from '../lib/desktop'

/** The header's preferences and desktop options. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const m = useMessages()
  const desktop = isDesktop()
  const [downloadsDir, setDownloadsDir] = useState<string>('')
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; body: string } | null>(
    null,
  )
  const [progress, setProgress] = useState<UpdateProgress | null>(null)

  useEffect(() => {
    if (desktop) {
      getDownloadsDir().then(setDownloadsDir)
      getDesktopInfo().then(setInfo)
    }
  }, [desktop])

  const handlePickFolder = async () => {
    const picked = await pickDownloadsDir()
    if (picked) {
      setDownloadsDir(picked)
    }
  }

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateStatus(null)
    setUpdateAvailable(null)
    try {
      const res = await checkForAppUpdates()
      if (res?.available && res.version) {
        setUpdateStatus(m.settings.updateAvailable(res.version))
        setUpdateAvailable({ version: res.version, body: res.body ?? '' })
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
    setProgress({ downloaded: 0, total: null, percent: null })
    try {
      await installUpdateAndRelaunch(setProgress)
    } catch {
      setUpdateStatus(m.settings.updateFailed ?? 'Update failed')
    } finally {
      setInstalling(false)
      setProgress(null)
    }
  }

  return (
    <Sheet label={m.settings.label} onClose={onClose}>
      <div className="space-y-6 p-5 sm:p-6 overflow-y-auto overscroll-contain">
        <div className="divide-y divide-ink-800">
          <div className="py-4 first:pt-0">
            <LanguagePicker />
          </div>

          <div className="py-4">
            <QualityPicker />
          </div>

          <div className="py-4">
            <LyricsToggle />
          </div>

          {desktop && (
            <>
              <div className="py-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-body font-medium text-ink-200">
                    {m.settings.downloadsFolder}
                  </span>
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    className="tap-target flex items-center gap-1.5 rounded-ctl border border-ink-700 px-2.5 py-1 text-xs font-medium text-ink-200 transition hover:border-lime-flash/50 hover:bg-ink-800 hover:text-lime-flash"
                  >
                    <FolderOpen className="size-3.5" />
                    {m.settings.changeFolder}
                  </button>
                </div>
                {/* LTR: a leading "~" or "/" is direction-neutral, so the
                    Farsi page would otherwise reorder the path's segments. */}
                <p
                  dir="ltr"
                  className="rounded-ctl bg-ink-900/80 p-2 text-start text-micro text-ink-300 break-all font-mono border border-ink-800"
                >
                  {downloadsDir || '...'}
                </p>
              </div>

              <div className="py-4 space-y-1.5 text-xs text-ink-400">
                <div className="flex items-center justify-between">
                  <span>{info?.version ? m.settings.appVersion(info.version) : ''}</span>
                  <button
                    type="button"
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate}
                    className="tap-target flex items-center gap-1.5 rounded-ctl border border-ink-700 px-2 py-1 text-xs font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
                  >
                    <RefreshCw className={clsx('size-3', checkingUpdate && 'animate-spin')} />
                    {checkingUpdate ? m.settings.checkingUpdates : m.settings.checkUpdates}
                  </button>
                </div>
                {updateStatus && (
                  <p className="text-micro text-lime-flash font-medium">{updateStatus}</p>
                )}
                {updateAvailable && (
                  <>
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      disabled={installing}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-ctl bg-lime-flash px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-lime-soft disabled:opacity-50"
                    >
                      {installing ? <RefreshCw className="size-3 animate-spin" /> : null}
                      {installing
                        ? (m.settings.installing ?? 'Installing…')
                        : (m.settings.installUpdate ?? 'Install & relaunch')}
                    </button>
                    {progress && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-micro text-ink-400">
                          <span>{m.settings.downloadingUpdate}</span>
                          <span dir="ltr" className="tabular-nums text-lime-flash">
                            {progress.percent !== null
                              ? `${m.app.num(progress.percent)}%`
                              : `${m.app.num((progress.downloaded / 1024 / 1024).toFixed(1))} MB`}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-ink-800">
                          {/* Fills and pulses when the feed sent no content
                              length — better than a percentage we made up. */}
                          <div
                            className={clsx(
                              'h-full rounded-full bg-lime-flash transition-[width] duration-200 ease-out',
                              progress.percent === null && 'animate-pulse',
                            )}
                            style={{ width: `${progress.percent ?? 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {/* Built by — only place it shows in the desktop app */}
        <div className="pt-4 mt-2 border-t border-ink-800 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-ink-500">
          <span>Built by</span>
          <a
            href="https://x.com/_amiralibgi"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-medium text-ink-400 underline decoration-ink-700 underline-offset-2 hover:text-lime-flash hover:decoration-lime-flash/40"
          >
            <img src="/amirali.jpg" alt="" className="size-4 rounded-full object-cover" />{' '}
            amiralibgi
          </a>
          <span>and</span>
          <a
            href="https://x.com/yazdanctx"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-medium text-ink-400 underline decoration-ink-700 underline-offset-2 hover:text-lime-flash hover:decoration-lime-flash/40"
          >
            <img src="/yazdan.jpg" alt="" className="size-4 rounded-full object-cover" /> yazdanctx
          </a>
        </div>
      </div>
    </Sheet>
  )
}
