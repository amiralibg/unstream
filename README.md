<p align="center">
  <img src="frontend/public/icon-192.png" width="96" alt="Unstream app icon" />
</p>

<h1 align="center">Unstream</h1>

<p align="center">
  <img src="docs/media/hero.png" alt="Unstream — your music library, as files" />
</p>

<p align="center">
  <a href="#get-the-app"><b>Get Desktop App</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#when-downloads-fail">Troubleshooting</a> ·
  <a href="README.fa.md">فارسی</a>
</p>

Paste a **Spotify / Deezer / Apple Music / YouTube / SoundCloud** track, album or playlist URL — or search every catalog at once — and get tagged audio files at the quality you pick (128 / 192 / 320 kbps mp3, or the original stream untouched).

No accounts. No API keys. Nothing paid. You run it, so the files are yours and nobody is standing in between.

> The interface ships in **Farsi and English**, switchable from the header. Farsi is the default because that is the audience it was built for ([why](docs/DESIGN.md#farsi-only)); set `UNSTREAM_DEFAULT_LOCALE=en` if you want English to be what people land on.

## Get the App (Recommended)

The easiest way to run Unstream without Docker. Runs completely locally on your device with no server dependencies for audio egress and saves tagged audio directly to your music library.

| Platform | Download | Instructions |
| --- | --- | --- |
| **macOS (Apple Silicon)** | [Download .dmg](https://github.com/amiralibg/unstream/releases/latest) | Unsigned v1: Right-click → Open, or run `xattr -d com.apple.quarantine /Applications/Unstream.app` |
| **macOS (Intel)** | [Download .dmg](https://github.com/amiralibg/unstream/releases/latest) | Same as above |
| **Windows** | [Download .exe](https://github.com/amiralibg/unstream/releases/latest) | Click "More info" → "Run anyway" if SmartScreen appears |
| **Linux** | [Download .AppImage / .deb](https://github.com/amiralibg/unstream/releases/latest) | `chmod +x` and run, or `dpkg -i` |

## Quick start (Docker)

You need [Docker](https://docs.docker.com/get-started/get-docker/). Nothing else — no Python, no Node, no ffmpeg on your machine.

```sh
git clone https://github.com/amiralibg/unstream.git
cd unstream
docker compose up -d
```

Open **<http://localhost:8080>**. Search for something, or paste a link, and hit download.

Finished tracks land in **`./downloads/<job-id>/`** — real files in a real folder, yours to move wherever your music lives. Nothing expires and nothing is cleaned up unless you ask for it.

That's the whole setup. If you want to change something, `cp .env.example .env` and read the comments — every setting is optional and documented there.

<table>
  <tr>
    <td width="50%"><img src="docs/media/progress.png" alt="Live per-track download progress" /></td>
    <td width="50%"><img src="docs/media/tagged.png" alt="Finished album — tagged mp3s and one-click ZIP" /></td>
  </tr>
</table>

### Running it on something small

A Raspberry Pi, a NAS, an old laptop — all fine, and you won't build anything: `docker compose up` pulls prebuilt `linux/amd64` and `linux/arm64` images from GHCR and only falls back to building from source if it can't.

On **Linux**, set the ownership of the files it writes so they belong to you rather than to the container's user:

```sh
echo "PUID=$(id -u)" >> .env
echo "PGID=$(id -g)" >> .env
docker compose up -d
```

macOS and Windows can skip that — Docker Desktop handles it.

## How it actually works

Streaming services are DRM-protected, so nothing is downloaded from them directly. Instead:

1. **Metadata** comes from free, keyless providers:
   - **Spotify embed pages** (`open.spotify.com/embed/…`) — the public iframe widget ships track lists as JSON. Used for pasted Spotify URLs; playlists longer than the widget's 100-row cap have their tail paged out of `api-partner.spotify.com/pathfinder`, the GraphQL endpoint the web player itself uses, with the anonymous token the widget mints.
   - **Deezer public API** — keyless; powers search (songs, albums, **artists**, playlists), full artist discographies, and Deezer URLs.
   - **iTunes Search API** — keyless; adds Apple Music coverage to search and resolves `music.apple.com` URLs.
   - **SoundCloud web API** — the site's own `api-v2` endpoints, using a client id scraped from its public JS bundles (the same trick yt-dlp uses). Full search parity: tracks, people, albums and playlists. Go-only (DRM) tracks are filtered out.
   - **yt-dlp** — reads public YouTube and SoundCloud pages; resolves their URLs and contributes YouTube search results.
   - **LRCLIB** — keyless lyric catalog, first pick for lyrics shown in the app and embedded into downloads, and the only source with time-synced LRC. It is asked several ways, because catalogs hand back the same song under a joined artist list, a `(feat. …)` title or a mixed-script one. **Genius** and **lyrics.ovh** follow when it misses. A source that starts refusing us is rested automatically rather than retried per track — see [DESIGN.md](docs/DESIGN.md#the-shape-of-it).

   Search fans out to four of these in parallel and merges the results, deduped by name + artist. There is deliberately no Spotify Web API integration — since 2025 it requires the app owner to hold an active Premium subscription, and this project stays free and keyless.

2. **yt-dlp** finds the audio: tracks already pointing at a YouTube/SoundCloud page download directly; everything else is searched (`ytsearch8:` on "artists - title") picking the result whose duration is closest to the catalog's, which rejects live versions and hour-long mixes. Retries exclude broken uploads, and the last attempt searches SoundCloud instead of YouTube.
3. The best audio stream is downloaded at the **quality** you picked — **ffmpeg** encodes mp3 at 128, 192 (default) or 320 kbps. **Original** skips the encode and keeps the upload's own stream — copy-codec remuxed into a pure audio file (opus out of webm, m4a out of a combined mp4) so it can carry tags and never arrives as a music video — best fidelity, since re-encoding an already-lossy source can only lose more.
4. **mutagen** embeds tags and cover art (and lyrics, when the user wants them and a source has them), as ID3, MP4 atoms or Vorbis comments depending on what came out.

```
frontend (Vite + React + Tailwind)  ──proxy /api──▶  backend (FastAPI)
                                                      ├─ embed.py       Spotify URL → metadata
                                                      ├─ deezer.py      search, artists, Deezer URLs
                                                      ├─ itunes.py      search, Apple Music URLs
                                                      ├─ ytdlp.py       YouTube/SoundCloud URLs + search
                                                      ├─ lyrics.py      lyrics, 3 sources, cached in SQLite
                                                      ├─ downloader.py  find audio → encode → tags
                                                      └─ jobs.py        thread pool + progress + sweeper
```

## Configuration

Everything is optional. `cp .env.example .env` and uncomment what you want — that file documents each setting and is the authority; this is the summary.

| Variable                  | Default (self-hosted) | Does                                                                                     |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `UNSTREAM_PORT`           | `8080`                | Host port for the web UI                                                                 |
| `UNSTREAM_DEFAULT_LOCALE` | `fa`                  | Language a first-time visitor gets: `fa` or `en`. Read at container start, so no rebuild |
| `DOWNLOADS_DIR`           | `./downloads`         | Where finished tracks land. Point it at an external disk or a NAS mount                  |
| `PUID` / `PGID`           | `1001`                | Who owns those files. Use `id -u` / `id -g` on Linux                                     |
| `DOWNLOADS_TTL_HOURS`     | `0` (never)           | Hours before a finished download is deleted                                              |
| `MAX_DOWNLOADS_GB`        | `0` (no cap)          | Disk ceiling; over it, finished jobs go oldest-first                                     |
| `DOWNLOAD_WORKERS`        | `3`                   | Tracks downloaded in parallel                                                            |
| `RATE_LIMITS_ENABLED`     | `false`               | Per-caller rate limits. **Turn on if strangers can reach it**                            |
| `MAX_TRACKS_PER_JOB`      | `0` (no limit)        | Tracks in one job                                                                        |
| `ADMIN_TOKEN`             | _unset_               | Enables the `/admin` dashboard. Unset = it doesn't exist                                 |

The **code's** defaults differ from the compose file's: they assume a server shared with strangers (downloads expire after 24h, disk capped at 20 GB, limits tight). `docker-compose.yml` overrides them toward "this is my machine". See [the design notes](docs/DESIGN.md#self-hosting).

### Language

Farsi (right-to-left) and English (left-to-right). Anyone can switch from the picker — in the header on a wide screen, in the settings sheet on a phone — and their choice is remembered in their own browser; `UNSTREAM_DEFAULT_LOCALE` only decides what someone who hasn't chosen yet sees.

```sh
echo "UNSTREAM_DEFAULT_LOCALE=en" >> .env
docker compose up -d
```

That takes effect on restart — no rebuild, even on the prebuilt images, because the frontend container writes the setting into a small `/config.js` when it starts. Switching languages flips the text direction, the numerals, and the page's own title and share metadata along with the copy.

**Adding a language** is two files, not a setting: copy `frontend/src/lib/locales/en.ts`, translate it, and add a line to `LOCALES` in `frontend/src/lib/i18n.tsx`. The dictionary's shape is a type, so a missing phrase fails the build instead of showing up blank. If the language writes numbers in its own digits, `app.num` in its dictionary is where that conversion goes — [the digit rule](docs/DESIGN.md#digits) explains why it lives there and not in the font.

## Can I host this for other people?

Not for YouTube audio on an ordinary VPS — and this is why the [Desktop App](#get-the-desktop-app) exists.

YouTube treats a datacenter address differently from a home one. From a VPS it answers `LOGIN_REQUIRED` at the playability check — before a proof-of-origin token is asked for and before a JS challenge exists to solve — so the defences the image ships cannot reach the point where they'd help. From the desktop app on a home connection, none of that happens.

Everything else — metadata resolution, search, Deezer/Spotify/Apple Music scraping, lyrics, and SoundCloud downloads — works fine from a VPS. If hosting a public instance, set `UNSTREAM_YOUTUBE_DISABLED=true` in `compose.dokploy.yml` to serve everything else honestly while prompting users to use the Desktop app for YouTube downloads.

If you're deploying it anyway — for yourself, behind a tunnel, or with proxied egress — use [`compose.dokploy.yml`](compose.dokploy.yml), which is the live deployment's file, and **set `RATE_LIMITS_ENABLED=true`**. Without accounts, per-IP limits are the only thing between your server and everyone.

## When downloads fail

Check **`GET /api/admin/extraction`** first (needs `ADMIN_TOKEN`). It reports what actually landed in the container and tells "never configured" apart from "configured and still blocked". `js_runtime: null` means nothing else is worth debugging first.

Then, roughly in order of how often it's the answer:

1. **Keep yt-dlp current.** These bypasses ship _inside_ yt-dlp releases, so a stale image is a stale workaround. The published images rebuild weekly for exactly this; if you built your own, `docker compose build --pull --no-cache api`.
2. **The JS challenge solver.** yt-dlp needs both a runtime (deno, in the image) and a script it downloads on first use, which `YTDLP_REMOTE_COMPONENTS` allows. With a runtime and no script it reports `Signature solving failed` and hands back a video with **no audio streams at all**.
3. **The PO token provider.** The `pot-provider` sidecar mints proof-of-origin tokens some clients are asked for. On by default, free, keyless.
4. **Cookies**, only if the above aren't enough — and on a home connection they almost never are needed. Use a **throwaway Google account**: every download is attributed to it and YouTube bans accounts for exactly that. Note that authenticating _changes which client yt-dlp picks_, moving it onto the web clients — so cookies without 2 and 3 in place make things worse, not better. See `.env.example` for the mount.

## Analytics

Unstream can count its own usage, with no third-party service, no cookie and no consent banner ([how it works](docs/DESIGN.md#analytics)). It is **off unless you set `ADMIN_TOKEN`**, and local either way — events go to a SQLite file on the `analytics` volume and are read back only by `/admin` on your own instance. Nothing is ever sent anywhere.

```sh
openssl rand -hex 24   # a token worth using
```

A caller is identified by a **daily-rotating hash of IP + user agent** — no address is stored, which also makes "returning visitors" deliberately unmeasurable. The page is `Disallow`ed in `robots.txt` and sets `noindex` on itself.

The `analytics` volume is the only copy of that history. It's in WAL mode and written to while you read it, so `cp` can hand you a torn database — use SQLite's own backup:

```sh
docker compose exec -T api python -c \
  "import sqlite3; src = sqlite3.connect('/app/data/analytics.db'); \
   dst = sqlite3.connect('/app/data/backup.db'); src.backup(dst); \
   dst.close(); src.close()" \
  && docker compose cp api:/app/data/backup.db "./analytics-$(date +%F).db"
```

## API

| Endpoint                                               | Purpose                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET /api/search?q=`                                   | Multi-source search → tracks, albums, artists, playlists                                  |
| `GET /api/artist/{id}`                                 | Artist page: top tracks + complete discography (Deezer)                                   |
| `POST /api/resolve` `{url}`                            | Spotify/Deezer/Apple Music/YouTube/SoundCloud URL → track list                            |
| `POST /api/download` `{url, track_ids?, quality?}`     | Start a job, returns `job_id`. `quality` is `128` \| `192` \| `320` \| `original`         |
| `GET /api/jobs/{id}`                                   | Per-track status/progress                                                                 |
| `GET /api/jobs?ids=a,b,c`                              | The same for several jobs — what the UI polls. Unknown ids are omitted rather than 404ing |
| `POST /api/jobs/{id}/cancel`                           | Stop a running job. Finished tracks keep their files; answers with the job's new state     |
| `GET /api/jobs/{id}/tracks/{tid}/file`                 | Download one finished track                                                               |
| `GET /api/jobs/{id}/zip`                               | ZIP of all finished tracks, streamed as it's built                                        |
| `GET /api/admin/stats?days=` · `/api/admin/extraction` | Dashboard and diagnostics, `Authorization: Bearer $ADMIN_TOKEN`                           |

## Development

Prereqs: Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 20+, ffmpeg (`brew install ffmpeg`).

```sh
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev
```

Then <http://localhost:5173>. Tests: `cd backend && uv run pytest`.

`UNSTREAM_DEFAULT_LOCALE` works in dev too — Vite serves the same `/config.js` the container generates, so `UNSTREAM_DEFAULT_LOCALE=en npm run dev` starts in English.

The decisions worth knowing before you change anything are in [`docs/DESIGN.md`](docs/DESIGN.md).

## Notes

- Playlists must be public. The embed-page provider even reads Spotify's editorial playlists, which the official API blocks for new apps.
- The embed pages are an undocumented structure — Spotify can change them any time. If resolving suddenly breaks, look at `backend/app/embed.py` first.
- Rate limits are in-memory and per process. Fine for the single-container stack here; a scaled-out API would need a shared store.

## Licence

[MIT](LICENSE). The bundled [Vazirmatn](https://github.com/rastikerdar/vazirmatn) and [Inter](https://github.com/rsms/inter) typefaces are under the SIL Open Font License 1.1 — see `frontend/public/fonts/OFL-Vazirmatn.txt` and `OFL-Inter.txt`.

## Legal

This project is a technical exercise in APIs, media pipelines and background jobs, and a tool for getting at music you already have the right to.

**Only download what you have the rights to.** Copyright law is yours to comply with, and running your own instance means the responsibility is yours too.

Unstream is not affiliated with, endorsed by, or connected to Spotify, Deezer, Apple, YouTube or SoundCloud. Those names are used only to describe what the software reads. No DRM is circumvented: nothing is downloaded from any streaming service, and audio comes from public YouTube and SoundCloud pages via yt-dlp.

---

Built by [amiralibgi](https://x.com/_amiralibgi) and [yazdanctx](https://x.com/yazdanctx).
