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
  type DesktopInfo,
} from '../lib/desktop'

/** The header's preferences and desktop options. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const m = useMessages()
  const desktop = isDesktop()
  const [downloadsDir, setDownloadsDir] = useState<string>('')
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

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
    try {
      const res = await checkForAppUpdates()
      if (res?.available && res.version) {
        setUpdateStatus(m.settings.updateAvailable(res.version))
      } else {
        setUpdateStatus(m.settings.upToDate)
      }
    } catch {
      setUpdateStatus(null)
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <Sheet label={m.settings.label} onClose={onClose}>
      <div className="space-y-6">
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
                <p className="rounded-ctl bg-ink-900/80 p-2 text-micro text-ink-300 break-all font-mono border border-ink-800">
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
                  <p className="text-micro text-lime-flash font-medium">
                    {updateStatus}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Sheet>
  )
}
