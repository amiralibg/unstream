import { useSyncExternalStore } from 'react'

/** Two independent choices: the palette (the original lime, or blue) and
 *  the mode (light, dark, or whatever the operating system says).
 *
 *  Every colour in the UI is a token in index.css, and each palette and mode
 *  is another set of values for the same tokens, keyed off `data-palette`
 *  and `data-theme` on <html>. So switching is an attribute: nothing
 *  re-renders, and no component knows which theme it is drawn in. */
export type ThemePreference = 'system' | 'light' | 'dark'
export type Palette = 'lime' | 'blue'

export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark']
export const PALETTES: Palette[] = ['lime', 'blue']

const KEY = 'unstream:theme'
const PALETTE_KEY = 'unstream:palette'
const media =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: light)')
    : null

function stored(): ThemePreference {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

function storedPalette(): Palette {
  try {
    return localStorage.getItem(PALETTE_KEY) === 'blue' ? 'blue' : 'lime'
  } catch {
    return 'lime'
  }
}

let preference: ThemePreference = stored()
let palette: Palette = storedPalette()
const listeners = new Set<() => void>()

function apply() {
  if (typeof document === 'undefined') return
  const resolved = preference === 'system' ? (media?.matches ? 'light' : 'dark') : preference
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.palette = palette
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Not remembered past this session; still applied now.
  }
  apply()
  for (const listener of listeners) listener()
}

export function setPalette(next: Palette) {
  palette = next
  try {
    localStorage.setItem(PALETTE_KEY, next)
  } catch {
    // Not remembered past this session; still applied now.
  }
  apply()
  for (const listener of listeners) listener()
}

// Applied when this module loads — imported by main.tsx before the first
// render — so a light-theme user never sees a dark frame first.
apply()
media?.addEventListener('change', () => {
  if (preference === 'system') apply()
})

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference)
}

export function usePalette(): Palette {
  return useSyncExternalStore(subscribe, () => palette)
}
