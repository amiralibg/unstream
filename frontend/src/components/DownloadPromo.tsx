import { Download } from 'lucide-react'
import { useMessages } from '../lib/i18n'
import { isLocal } from '../lib/desktop'

/** The landing page's way onto `/download`: one quiet card, one button. The
 *  page itself resolves the version and the file links, so this stays static
 *  and costs the landing no network at all.
 *  Omitted when running locally since the user already has it running on their machine. */
export function DownloadPromo() {
  const m = useMessages()
  if (isLocal()) return null

  return (
    <section
      aria-label={m.download.title}
      className="mt-10 flex animate-fade-up flex-wrap items-center gap-x-4 gap-y-3 rounded-panel border border-lime-flash/25 bg-lime-flash/[0.06] p-5 [animation-delay:260ms] sm:p-6"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-lime-flash text-lime-ink">
        <Download className="size-5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <h2 className="font-display text-lg font-bold">{m.download.title}</h2>
        <p className="mt-0.5 text-mini leading-relaxed text-ink-300">{m.download.promoBlurb}</p>
      </div>
      <a
        href="/download"
        className="shrink-0 rounded-btn bg-lime-flash px-5 py-2.5 text-mini font-bold text-ink-950 transition hover:bg-lime-flash/90 active:scale-[0.98]"
      >
        {m.banner.getApp}
      </a>
    </section>
  )
}
