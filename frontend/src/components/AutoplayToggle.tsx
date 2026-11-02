import clsx from 'clsx'
import { useMessages } from '../lib/i18n'
import { usePlayer } from '../lib/player'

/** Whether the player keeps going with similar songs once the queue ends.
 *
 *  A two-segment strip like the lyrics and quality ones rather than a lone
 *  switch, for the same reason LyricsToggle gives: both answers are on
 *  screen and the lit one is the setting, with no colour asked to say "on".
 */
export function AutoplayToggle({
  className,
  hideLabel = false,
}: {
  className?: string
  /** Where a heading beside it already says what it is. */
  hideLabel?: boolean
}) {
  const m = useMessages()
  const { autoplay, toggleAutoplay } = usePlayer()

  return (
    <div className={clsx('flex items-center gap-2', className)}>
      {!hideLabel && (
        <span className="text-micro font-semibold text-ink-400">{m.player.autoplay.label}</span>
      )}
      <div
        role="radiogroup"
        aria-label={m.player.autoplay.label}
        className="flex items-center gap-0.5 rounded-ctl border border-ink-800 bg-ink-900 p-0.5"
      >
        {([true, false] as const).map((on) => {
          const active = on === autoplay
          const hint = on ? m.player.autoplay.on : m.player.autoplay.off
          return (
            <button
              key={String(on)}
              type="button"
              role="radio"
              aria-checked={active}
              title={hint}
              onClick={() => {
                if (!active) toggleAutoplay()
              }}
              className={clsx(
                'h-[26px] rounded-ctl px-2.5 text-micro font-semibold transition duration-200 active:scale-95',
                active ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100',
              )}
            >
              {on ? m.player.autoplay.onShort : m.player.autoplay.offShort}
            </button>
          )
        })}
      </div>
    </div>
  )
}
