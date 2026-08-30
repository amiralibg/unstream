import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener'
import { open } from '@tauri-apps/plugin-dialog'
import { check } from '@tauri-apps/plugin-updater'

export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  )
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

export async function checkForAppUpdates(): Promise<{
  available: boolean
  version?: string
  body?: string
} | null> {
  if (!isDesktop()) return null
  try {
    const update = await check()
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
