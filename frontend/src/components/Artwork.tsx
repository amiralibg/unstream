import { useEffect, useState } from 'react'
import { Music2 } from 'lucide-react'
import clsx from 'clsx'

/** Cover art for a library track, with the glyph as its floor.
 *
 *  `hasCover` comes from the scan, so a track known to carry no art never
 *  fires a request that would only 404. Art that fails to decode anyway —
 *  a truncated JPEG in a file tagged by something else — falls back to the
 *  same glyph rather than leaving a broken-image box.
 *
 *  Images are `loading="lazy"` and decoded off the main thread: a library
 *  of a few thousand rows would otherwise decode every cover on first paint.
 */
export function Artwork({
  src,
  hasCover = true,
  alt = '',
  className,
  iconClassName,
  rounded = 'rounded-[10px]',
  overlay,
}: {
  src?: string
  hasCover?: boolean
  alt?: string
  className?: string
  iconClassName?: string
  rounded?: string
  overlay?: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)

  // A new track in the same slot deserves a fresh attempt; without this the
  // next row to reuse this component would inherit the last one's failure.
  useEffect(() => setBroken(false), [src])

  const showImage = Boolean(src) && hasCover && !broken

  return (
    <span
      className={clsx(
        'relative grid shrink-0 place-items-center overflow-hidden ring-1 transition',
        showImage ? 'bg-black/40 ring-white/[0.08]' : 'bg-white/[0.05] ring-white/[0.06]',
        rounded,
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        <Music2 className={clsx('text-ink-500', iconClassName ?? 'size-5')} />
      )}
      {overlay}
    </span>
  )
}

/** The three bouncing bars that mean "this row is the one playing". Kept
 *  here so the list, the bar and the queue all use the same one. */
export function PlayingBars({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-end gap-[3px]', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom animate-eq rounded-full bg-lime-flash"
          style={{ height: `${[10, 16, 12][i]}px`, animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  )
}
