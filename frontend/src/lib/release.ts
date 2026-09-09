import { useCallback, useEffect, useState } from 'react'

export const REPO = 'amiralibg/unstream'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const UPDATER_FEED = `https://github.com/${REPO}/releases/latest/download/latest.json`
const CACHE_KEY = 'unstream:release'
/** An hour: kind to the unauthenticated GitHub quota (60/hr per IP). */
const CACHE_TTL = 60 * 60 * 1000

export interface ReleaseAsset {
  name: string
  url: string
}

export interface ReleaseInfo {
  version: string
  assets: ReleaseAsset[]
  /** From the releases API — the asset list is what is really published.
   *  The fallback only knows the version, so links are templates. */
  live: boolean
}

/** Every installer the release workflow publishes, as a name template. */
export const filesFor = (v: string) => ({
  macArm: `Unstream_${v}_aarch64.dmg`,
  macIntel: `Unstream_${v}_x64.dmg`,
  winX64Exe: `Unstream_${v}_x64-setup.exe`,
  winX64Msi: `Unstream_${v}_x64_en-US.msi`,
  winArmExe: `Unstream_${v}_arm64-setup.exe`,
  winArmMsi: `Unstream_${v}_arm64_en-US.msi`,
  linX64App: `Unstream_${v}_amd64.AppImage`,
  linX64Deb: `Unstream_${v}_amd64.deb`,
  linArmApp: `Unstream_${v}_aarch64.AppImage`,
  linArmDeb: `Unstream_${v}_arm64.deb`,
})

const downloadBase = (v: string) => `https://github.com/${REPO}/releases/download/v${v}/`

async function fetchRelease(): Promise<ReleaseInfo> {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    }
    const version = String(data.tag_name ?? '').replace(/^v/, '')
    if (!version) throw new Error('no version')
    return {
      version,
      assets: (data.assets ?? [])
        .filter((a) => a.name && a.browser_download_url)
        .map((a) => ({ name: a.name as string, url: a.browser_download_url as string })),
      live: true,
    }
  } catch {
    // Rate-limited or offline: the updater feed is on the same CDN as the
    // files themselves and carries the version, so links can be templated.
    const res = await fetch(UPDATER_FEED)
    if (!res.ok) throw new Error(`feed ${res.status}`)
    const data = (await res.json()) as { version?: string }
    const version = String(data.version ?? '')
    if (!version) throw new Error('no version')
    const base = downloadBase(version)
    return {
      version,
      assets: Object.values(filesFor(version)).map((name) => ({ name, url: base + name })),
      live: false,
    }
  }
}

export type OS = 'mac' | 'windows' | 'linux'

export function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'mac'
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (/mac|iphone|ipad/.test(ua)) return 'mac'
  if (/win/.test(ua)) return 'windows'
  return 'linux'
}

export function detectArm(): boolean | null {
  if (typeof navigator === 'undefined') return null
  const withData = navigator as Navigator & {
    userAgentData?: { architecture?: string; platform?: string }
  }
  const arch = withData.userAgentData?.architecture?.toLowerCase() ?? ''
  if (arch) return arch.includes('arm')
  const ua = `${navigator.userAgent}`.toLowerCase()
  if (/aarch64|arm64|apple silicon/.test(ua)) return true
  if (/x86_64|x64|wow64|win64/.test(ua)) return false
  return null
}

function readCache(): ReleaseInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as ReleaseInfo & { at: number }
    if (!cached.version || Date.now() - cached.at > CACHE_TTL) return null
    return { version: cached.version, assets: cached.assets ?? [], live: cached.live ?? false }
  } catch {
    return null
  }
}

/** The latest GitHub release: version plus resolvable file links. Warms from
 *  cache so the page paints instantly, then revalidates. */
export function useRelease() {
  const [release, setRelease] = useState<ReleaseInfo | null>(readCache)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(!readCache())

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const info = await fetchRelease()
      setRelease(info)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ...info, at: Date.now() }))
      } catch {
        // private mode — the page still works for this visit
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pick = useCallback(
    (name: string): string | null => release?.assets.find((a) => a.name === name)?.url ?? null,
    [release],
  )

  return { release, failed, loading, reload: load, pick }
}
