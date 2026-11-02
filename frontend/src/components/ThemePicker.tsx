import { Monitor, Moon, Sun } from 'lucide-react'
import clsx from 'clsx'
import { useMessages } from '../lib/i18n'
import { setThemePreference, THEME_PREFERENCES, useThemePreference } from '../lib/theme'

const ICONS = { system: Monitor, light: Sun, dark: Moon }

/** Light, dark, or follow the system — a radiogroup like the language and
 *  quality strips beside it, so all three sit on one baseline. */
export function ThemePicker({ className }: { className?: string }) {
  const m = useMessages()
  const current = useThemePreference()

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <span className="text-micro font-semibold text-ink-400">{m.theme.label}</span>
      <div
        role="radiogroup"
        aria-label={m.theme.label}
        className="flex items-center gap-0.5 rounded-ctl border border-ink-800 bg-ink-900 p-0.5"
      >
        {THEME_PREFERENCES.map((option) => {
          const Icon = ICONS[option]
          const active = option === current
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={m.theme[option]}
              title={m.theme[option]}
              onClick={() => setThemePreference(option)}
              className={clsx(
                'grid size-[26px] place-items-center rounded-ctl transition duration-200 active:scale-95 pointer-coarse:size-8',
                active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100',
              )}
            >
              <Icon className="size-3.5" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
