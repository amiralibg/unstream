import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Windowing for a long list of equal-height rows.
 *
 *  A library is thousands of files, and every row carries a cover image.
 *  Rendering all of them means thousands of DOM nodes and as many image
 *  decodes on first paint; the list then janks on every keystroke in the
 *  filter box. This keeps the mounted set to what fits on screen plus a
 *  little overscan, so scrolling and filtering cost the same at 20 rows
 *  and at 20,000.
 *
 *  Deliberately fixed-height: the rows are a uniform size by design, and
 *  measuring each one would cost more than it saves. Anything with variable
 *  heights wants a real virtualizer, not this.
 */
export function useVirtualRows({
  count,
  rowHeight,
  overscan = 8,
}: {
  count: number
  rowHeight: number
  overscan?: number
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const frame = useRef(0)

  const onScroll = useCallback(() => {
    // One state write per frame: the scroll event fires far more often than
    // the screen refreshes, and each write here re-renders the list.
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      setScrollTop(scrollRef.current?.scrollTop ?? 0)
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewport(el.clientHeight)
    const observer = new ResizeObserver(() => setViewport(el.clientHeight))
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [])

  const { start, end } = useMemo(() => {
    // Before the first measurement, render a screenful rather than nothing —
    // otherwise the list is blank for a frame on mount.
    const height = viewport || 800
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const visible = Math.ceil(height / rowHeight) + overscan * 2
    return { start: first, end: Math.min(count, first + visible) }
  }, [scrollTop, viewport, rowHeight, count, overscan])

  return {
    scrollRef,
    onScroll,
    start,
    end,
    /** Total scrollable height, so the scrollbar matches the real list. */
    totalHeight: count * rowHeight,
    /** Offset of the first mounted row inside that height. */
    offsetTop: start * rowHeight,
  }
}
