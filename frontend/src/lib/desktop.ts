import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener'
import { open } from '@tauri-apps/plugin-dialog'
import { check, type Update } from '@tauri-apps/plugin-updater'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window ||
      '__TAURI__' in window ||
      (import.meta.env.DEV && new URLSearchParams(window.location.search).has('desktop-preview')))
  )
}

/** Whether the app is being run locally on the user's machine (desktop Tauri shell,
 *  localhost, loopback IP, or local LAN / private IP). Used to omit promotional download
 *  prompts that only make sense on hosted/public web instances. */
export function isLocal(): boolean {
  if (typeof window === 'undefined') return false
  if (isDesktop()) return true
  const host = window.location.hostname
  if (!host) return false
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true
  }
  // Private LAN IP ranges (127.x.x.x, 10.x.x.x, 192.168.x.x, 172.16-31.x.x)
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return true
  }
  return false
}

/** macOS, where the window's traffic lights are drawn by the OS over the
 *  webview's physical top-left. Anything a full-screen view puts in that
 *  corner lands underneath them, so overlays reserve the space — see the
 *  76px inset in `DesktopTitleBar`. */
export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return true
  return /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform)
}

export async function getDownloadsDir(): Promise<string> {
  if (!isDesktop()) return ''
  try {
    const fromTauri = await invoke<string>('get_downloads_dir')
    if (fromTauri) return fromTauri
  } catch {
    // fallback
  }
  try {
    const res = await fetch('/api/desktop/config')
    if (res.ok) {
      const data = await res.json()
      return data.downloads_dir || ''
    }
  } catch {
    // ignore
  }
  return ''
}

export async function setDownloadsDir(path: string): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    await invoke('set_downloads_dir', { path })
  } catch (err) {
    console.error('Failed to set downloads dir in Tauri:', err)
  }
  try {
    await fetch('/api/desktop/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloads_dir: path }),
    })
    return true
  } catch (err) {
    console.error('Failed to sync downloads dir to backend:', err)
    return false
  }
}

export interface BackendDesktopConfig {
  downloads_dir: string
  cookies_from_browser: string | null
}

export async function getBackendDesktopConfig(): Promise<BackendDesktopConfig | null> {
  if (!isDesktop()) return null
  try {
    const res = await fetch('/api/desktop/config')
    if (res.ok) return (await res.json()) as BackendDesktopConfig
  } catch {
    // backend not up yet — settings shows the default until it is
  }
  return null
}

/** Live-switch which browser YouTube cookies are read from ("" clears it).
 *  Takes effect on the next download, no restart. */
/** Browser ids installed on this machine, in `BROWSER_ALLOWLIST` order.
 *
 *  Empty means either "none found" or "not the desktop app" — the caller
 *  treats both the same way, by saying so rather than by offering a list
 *  of browsers that aren't there. */
export async function listInstalledBrowsers(): Promise<string[]> {
  if (!isDesktop()) return []
  try {
    return (await invoke<string[]>('list_installed_browsers')) ?? []
  } catch {
    return []
  }
}

export async function setCookiesFromBrowser(browser: string): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const res = await fetch('/api/desktop/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies_from_browser: browser }),
    })
    return res.ok
  } catch (err) {
    console.error('Failed to set cookies browser:', err)
    return false
  }
}

export async function pickDownloadsDir(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    const selected = await open({
      directory: true,
      multiple: false,
    })
    if (typeof selected === 'string') {
      await setDownloadsDir(selected)
      return selected
    }
    return null
  } catch (err) {
    console.error('Failed to pick directory:', err)
    return null
  }
}

export async function revealFile(filePath: string): Promise<void> {
  if (!isDesktop() || !filePath) return
  try {
    await revealItemInDir(filePath)
  } catch (err) {
    console.error('Failed to reveal file:', err)
  }
}

export async function openFolder(folderPath: string): Promise<void> {
  if (!isDesktop() || !folderPath) return
  try {
    await openPath(folderPath)
  } catch (err) {
    console.error('Failed to open folder:', err)
  }
}

export interface DesktopInfo {
  isDesktop: boolean
  port: number
  downloadsDir: string
  version: string
}

export async function getDesktopInfo(): Promise<DesktopInfo | null> {
  if (!isDesktop()) return null
  try {
    return await invoke<DesktopInfo>('get_desktop_info')
  } catch (err) {
    console.error('Failed to get desktop info:', err)
    return null
  }
}

/** The `Update` the last check handed back, kept so installing does not
 *  re-fetch the feed — and so the build that installs is the one the person
 *  was shown, not whatever the endpoint serves a minute later. */
let pendingUpdate: Update | null = null

export async function checkForAppUpdates(): Promise<{
  available: boolean
  version?: string
  body?: string
} | null> {
  if (!isDesktop()) return null
  try {
    const update = await check()
    pendingUpdate = update
    if (update) {
      return {
        available: true,
        version: update.version,
        body: update.body ?? '',
      }
    }
    return { available: false }
  } catch (err) {
    console.error('Update check failed:', err)
    return null
  }
}
export async function startDragging(): Promise<void> {
  if (!isDesktop()) return
  try {
    await invoke('start_dragging')
  } catch {
    // fallback
  }
}

export async function toggleMaximize(): Promise<void> {
  if (!isDesktop()) return
  try {
    await invoke('toggle_maximize')
  } catch {
    // fallback
  }
}

export async function minimizeWindow(): Promise<void> {
  if (!isDesktop()) return
  try {
    await invoke('minimize_window')
  } catch {
    // fallback
  }
}

export async function closeWindow(): Promise<void> {
  if (!isDesktop()) return
  try {
    await invoke('close_window')
  } catch {
    // fallback
  }
}

export async function setWindowProgress(progress: number | null): Promise<void> {
  if (!isDesktop()) return
  try {
    await invoke('set_progress_bar', { progress })
  } catch {
    // ignore — not all platforms support it
  }
}

export async function focusMainWindow(): Promise<void> {
  if (!isDesktop()) return
  try {
    await invoke('focus_window')
  } catch {
    // ignore
  }
}

export async function notifyDownloadComplete(title: string, body: string): Promise<void> {
  if (!isDesktop()) return
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      const perm = await requestPermission()
      granted = perm === 'granted'
    }
    if (granted) {
      sendNotification({ title, body })
    }
  } catch {
    // ignore
  }
}

/** How far the update download has got. `total` is null until the server
 *  answers with a content length — some mirrors never do, which is why the
 *  UI needs to tell a real percentage apart from a missing one. */
export interface UpdateProgress {
  downloaded: number
  total: number | null
  percent: number | null
}

export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const update = pendingUpdate ?? (await check())
    if (!update) return false
    let total: number | null = null
    let downloaded = 0
    const report = () =>
      onProgress?.({
        downloaded,
        total,
        percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
      })
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? null
          downloaded = 0
          report()
          break
        case 'Progress':
          downloaded += event.data.chunkLength
          report()
          break
        case 'Finished':
          // The last Progress can land short of the content length when the
          // body is compressed; finishing means 100%, whatever the sum says.
          total = total ?? downloaded
          downloaded = total
          report()
          break
      }
    })
    pendingUpdate = null
    return true
  } catch (err) {
    console.error('Update download and install failed:', err)
    throw err
  }
}

export async function relaunchApp(): Promise<void> {
  if (!isDesktop()) {
    window.location.reload()
    return
  }
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (err) {
    console.error('Relaunch failed, falling back to reload:', err)
    window.location.reload()
  }
}

export async function installUpdateAndRelaunch(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  await downloadAndInstallUpdate(onProgress)
  await relaunchApp()
}
