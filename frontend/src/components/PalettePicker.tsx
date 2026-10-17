import clsx from 'clsx'
import { useMessages } from '../lib/i18n'
import { PALETTES, setPalette, usePalette, type Palette } from '../lib/theme'

/** The two accents, shown as themselves. Fixed colours on purpose: a swatch
 *  drawn from the tokens would show the palette in use, not the one it
 *  offers. */
const SWATCH: Record<Palette, string> = {
  lime: '#c8f24f',
  blue: '#5b9cff',
}

export function PalettePicker({ className }: { className?: string }) {
  const m = useMessages()
  const current = usePalette()

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <span className="text-micro font-semibold text-ink-400">{m.theme.palette}</span>
      <div
        role="radiogroup"
        aria-label={m.theme.palette}
        className="flex items-center gap-0.5 rounded-ctl border border-ink-800 bg-ink-900 p-0.5"
      >
        {PALETTES.map((option) => {
          const active = option === current
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              title={m.theme.palettes[option]}
              onClick={() => setPalette(option)}
              className={clsx(
                'flex h-[26px] items-center gap-1.5 rounded-ctl px-2 text-micro font-medium transition duration-200 active:scale-95 pointer-coarse:h-8',
                active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100',
              )}
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full ring-1 ring-fg/[0.15]"
                style={{ background: SWATCH[option] }}
              />
              {m.theme.palettes[option]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
