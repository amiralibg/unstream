# Unstream on the device: Desktop app

## Context

The README already states the problem this plan solves, in [Can I host this for
other people?](README.md#can-i-host-this-for-other-people): YouTube answers a
datacenter address with `LOGIN_REQUIRED` at the playability check, *before* a PO
token is asked for and before a JS challenge exists to solve. The two defences
the image ships (`YTDLP_REMOTE_COMPONENTS`, `bgutil-ytdlp-pot-provider`) never
get a turn. Only a cookie from a throwaway account gets past it, and that trades
one problem for a bannable one. The live instance's IP is now flagged, so
strangers can't download from it.

There is no fix on the server side that doesn't cost money (residential proxy)
or an account. The fix is to move egress onto the user's own connection.

**The block is narrower than it looks.** It only affects fetching YouTube audio.
Everything else in `backend/app/` — `deezer.py`, `itunes.py`, `embed.py`,
`soundcloud.py`, `lyrics.py`, and SoundCloud downloads — works fine from a VPS
and always has. That is what makes the split clean:

```
Hosted site (stays up)          Desktop app (new)
  search, resolve, lyrics         everything, fully local
  SoundCloud downloads            no dependency on the server
  banner → get the app            egress = the user's home connection
```

**Outcome:** a signed-or-not installable app for macOS / Windows / Linux that
runs the existing FastAPI backend on `127.0.0.1` and writes tagged files
straight into the user's music folder. iOS/mobile is not planned.

---

## Why Tauri, and why the backend keeps serving the SPA

**Tauri v2, not Electron.** The frontend is a plain Vite SPA; the shell only has
to host a webview and spawn processes. Tauri uses the system webview (~10 MB
shell) against Electron's bundled Chromium (~100 MB), which matters because the
Python + ffmpeg + deno payload is already ~150 MB. Tailwind v4 needs Chrome 111
/ Safari 16.4, which WebView2 (evergreen) and modern WKWebView both clear; an
old WebKitGTK on Linux is the one soft spot, and Linux users keep `docker
compose` as the supported path.

**The webview loads `http://127.0.0.1:<port>/`, served by FastAPI.** This is the
decision that keeps the frontend diff near zero:

- `frontend/src/lib/api.ts:115` (`baseURL: '/api'`) works unchanged.
- The service worker in `frontend/sw.template.js` needs a real HTTP origin — it
  would not register under `tauri://`.
- The CORS block in `main.py:178` needs no new origins.
- Self-hosters get a single-container option for free.

The alternative (Tauri's asset protocol + an injected `apiBase`) would force a
config seam through `api.ts`, break the service worker, and widen CORS. Not
worth it.

**Binary discovery needs no Python change at all.** `downloader.py:482` checks
`shutil.which("ffmpeg")`, `_run_ffmpeg` (`downloader.py:164`) invokes bare
`"ffmpeg"`, and `ytdlp.py:150` `_js_runtime()` walks `shutil.which` over
`deno / bun / node / quickjs`. The Rust launcher prepends the bundled-binary
directory to `PATH` on the spawned process and all three find what they need.

---

## Phase 1 — Desktop

### 1. Backend: three small changes

**`backend/app/jobs.py:31` — make the downloads directory configurable.**
It is currently hardcoded to `backend/downloads`. The `DOWNLOADS_DIR` in
`.env.example` is a compose bind-mount, not something the app reads. Follow the
pattern already used by `analytics.py:30` and `lyrics.py:48`:

```python
DOWNLOADS_DIR = Path(
    os.getenv("UNSTREAM_DOWNLOADS_DIR", Path(__file__).resolve().parent.parent / "downloads")
)
```

The desktop launcher points it at `~/Music/Unstream` (user-changeable, § 4).

**`backend/app/main.py` — serve the built SPA when told to.**
Mount `StaticFiles` at `/` behind a new `UNSTREAM_STATIC_DIR`, after every
`/api/*` and `/health` route so it can't shadow them. Needs an SPA fallback that
returns `index.html` for unknown paths, because `main.tsx:14` routes `/admin`
client-side off `window.location.pathname`.

**`backend/app/main.py` — reject cross-origin drive-by requests.**
A loopback server is reachable by any page in the user's browser. CORS stops a
foreign origin *reading* a response but not firing `POST /api/download`, and DNS
rebinding gets past a naive host check. A ~10-line middleware that rejects any
request carrying an `Origin` header that isn't the app's own closes both. Same
middleware is a no-op for the existing Docker deployment, where `Origin` is
absent or already allowed.

Everything else desktop mode needs is *already* env-driven and set by the
launcher, no code change: `DOWNLOADS_TTL_HOURS=0`, `MAX_DOWNLOADS_GB=0`
(`jobs.py:36,47`), `RATE_LIMITS_ENABLED=false`, `DOWNLOAD_WORKERS=4`,
`LYRICS_DB_PATH` / `ANALYTICS_DB_PATH` → the OS app-data dir, `YTDLP_CACHE_DIR`
→ the OS cache dir. `ADMIN_TOKEN` stays unset, which already disables analytics
and `/admin` entirely. The launcher additionally sets what a single-user
machine wants and a server must never have: `MAX_ACTIVE_JOBS_PER_CLIENT=0`
and `MAX_TRACKS_PER_JOB=0` (both mean "no limit", per `main.py`'s `> 0`
guards), `UNSTREAM_DESKTOP=1` (bot-check errors name the Settings toggle
instead of a server env var), and `YTDLP_PLAYER_CLIENTS=tv,web` (the TV
client survives bot checks the web client no longer does, even on home
connections). `YTDLP_COOKIES_FROM_BROWSER` stays unset until the person picks
a browser in Settings — their own account on their own machine, which is why
cookies are a fix on desktop and a bannable liability on a server.

### 2. Packaging the sidecar

New top-level `desktop/` (Tauri project) alongside `backend/` and `frontend/`.

**Python → one binary tree.** PyInstaller **one-dir** (not `--onefile`; a
60 MB self-extract on every launch is a visible startup stall), shipped via
Tauri `bundle.resources` and spawned by the Rust side with an absolute path.

> **This is the main packaging risk.** yt-dlp resolves extractors lazily through
> `importlib`, and `bgutil-ytdlp-pot-provider` is found by scanning the
> `yt_dlp_plugins` namespace package. Expect to need `--collect-all yt_dlp`,
> `--collect-all yt_dlp_plugins`, and hidden imports for `uvicorn`'s loop/
> protocol implementations. Budget real time here and verify by running
> `backend/tests/` against the *frozen* binary, not just the source tree.

**ffmpeg**, static per-platform build (BtbN for Windows/Linux, a stripped
audio-only macOS build). Note the licence: Unstream is MIT, but a GPL ffmpeg
binary redistributed inside the bundle obliges you to carry its licence text and
a source offer. An LGPL build avoids that; either is fine, pick one deliberately.

**deno**, matching `backend/Dockerfile`'s `DENO_VERSION`. ~40 MB per platform
and the single largest line item. `quickjs` is ~1 MB and `_js_runtime()` already
accepts it — worth testing as a size win, but deno is what the Dockerfile has
proven against the EJS solver, so it ships first.

**Not bundled:** the `pot-provider` sidecar. PO tokens are a datacenter-IP
problem; a home connection rarely needs them. `POT_PROVIDER_URL` stays as an
env seam.

Rough bundle: ~180 MB installed, ~70 MB compressed, per platform.

### 3. The Rust shell (`desktop/src-tauri/`)

On startup: pick a free loopback port → spawn the sidecar with `PATH` prefixed
by the bundled-binary dir and the env from § 1 → poll `GET /health` (it already
exists, `main.py:215`) until it answers → navigate the webview to
`http://127.0.0.1:<port>/`. On exit, terminate the child; on a crash, restart it
once and surface a real error rather than a blank window.

Plugins: `shell` (spawn), `opener` (reveal in Finder/Explorer), `dialog` (folder
picker), `updater` (§ 5).

### 4. Frontend: desktop affordances only

Gate on `'__TAURI_INTERNALS__' in window` so the same bundle still serves the web.

- **`frontend/src/components/DownloadsDock.tsx:104,241`** — the `<a download>`
  for a track and the ZIP link become "reveal in folder" via the opener plugin.
  On the desktop the file is *already* on disk; re-downloading it through HTTP
  into `~/Downloads` is the wrong gesture.
- **`frontend/src/components/SettingsSheet.tsx`** — show the downloads folder
  with a change button, the running yt-dlp version, and an update check.
- **New strings in `frontend/src/lib/locales/en.ts` and `fa.ts`.** The dictionary
  shape is a type, so a missing Farsi phrase fails the build. Follow `CONTEXT.md`
  for the canonical Farsi terms (**دانلود**, **آهنگ**, …) — don't invent new ones.

### 5. Releases, and the thing that will actually break this

**A desktop app with a pinned yt-dlp stops working within weeks.**
`.github/workflows/publish.yml` already says why and rebuilds the images weekly
on `cron: "17 4 * * 1"` — but a user who installed once will never reinstall.
The updater is not a nice-to-have here, it is the feature that keeps the app
alive.

New `.github/workflows/desktop.yml`, same weekly cron plus tags, matrix over
`macos-14` (arm64), `macos-13` (x64), `windows-latest`, `ubuntu-latest`. Each
job: build the frontend, PyInstaller the backend, fetch ffmpeg + deno,
`tauri build`, upload to a GitHub Release. Generate `latest.json` for
`tauri-plugin-updater` (`tauri signer generate` for the keypair; private key in
Actions secrets). GitHub Releases hosts it, free.

**Signing, stated plainly.** Unsigned macOS builds get quarantined and users must
right-click → Open; ad-hoc signing at least avoids the "app is damaged" error.
Windows SmartScreen warns until reputation accrues. Apple Developer is $99/yr and
an EV code-signing cert ~$300/yr. v1 ships unsigned with instructions in the
README; revisit if adoption justifies it.

### 6. The hosted site keeps its job

Add `UNSTREAM_YOUTUBE_DISABLED=true` to the server's `compose.dokploy.yml` env.
When set: `main.py`'s search fan-out drops YouTube-sourced results, and the UI
shows a banner explaining that YouTube downloads need the app, with a link.
SoundCloud, search, resolve and lyrics carry on exactly as now. This turns the
flagged IP from a broken instance into an honest one.

README and `README.fa.md` get a "Get the app" section above Quick start, and the
existing "Can I host this for other people?" section gains its answer.

---

## Verification

**Backend changes still work everywhere:**

```sh
cd backend && uv run pytest            # existing suite must stay green
docker compose up -d && open http://localhost:8080   # unchanged behaviour
```

**The frozen sidecar is the real test** — run the suite against the PyInstaller
output, not the source tree, and confirm `GET /api/admin/extraction` (with
`ADMIN_TOKEN` set) reports a non-null `js_runtime`. `js_runtime: null` means
deno wasn't found on the spawned `PATH` and nothing else is worth debugging.

**End to end on each platform**, install from the built bundle, not `tauri dev`:

1. Search for a track → results include YouTube-sourced ones.
2. Paste a Spotify album URL → resolves via `embed.py`.
3. Download at `320` and at `original` → both land in `~/Music/Unstream/<job>/`.
4. Open a finished file → tags and cover art present (this exercises the frozen
   mutagen path).
5. Cancel a running job mid-download → job reports `cancelled`, finished tracks
   keep their files.
6. Reveal in folder opens the right directory.
7. **The one that matters:** confirm a YouTube download that fails on the VPS
   succeeds from the app on a home connection.

**Updater:** publish a build, bump the version, publish again, confirm an
installed copy offers and applies the update.

**Hosted site:** with `UNSTREAM_YOUTUBE_DISABLED=true`, search returns no
YouTube results, SoundCloud downloads still work, and the banner appears.

---

## Order of work, and where it stands

Steps 1–4 are where the risk is. Steps 5–7 are ordinary work.

- [x] **1. Backend seams.** `UNSTREAM_DOWNLOADS_DIR` in `backend/app/jobs.py`,
      the `UNSTREAM_STATIC_DIR` SPA mount and the cross-origin middleware in
      `backend/app/main.py`, plus tests for each. Docker behaviour must not
      change: `uv run pytest` green and `docker compose up -d` still serves
      `localhost:8080` exactly as before.
- [x] **2. PyInstaller spec.** The frozen backend passes `backend/tests/` and
      serves the built SPA. Expect to fight `--collect-all yt_dlp` /
      `yt_dlp_plugins` and uvicorn's loop and protocol imports.
- [x] **3. Tauri shell** (`desktop/src-tauri/`). Free-port pick, sidecar spawn
      with a prefixed `PATH`, `/health` poll, navigate to `127.0.0.1:<port>`.
- [x] **4. Bundle ffmpeg + deno.** Done when `GET /api/admin/extraction` inside
      the *built* app reports a non-null `js_runtime`. `null` there means the
      spawned `PATH` is wrong and nothing else is worth debugging first.
- [x] **5. Frontend desktop affordances.** Reveal-in-folder in
      `DownloadsDock.tsx`, folder picker and version info in `SettingsSheet.tsx`,
      new strings in both `en.ts` and `fa.ts`.
- [x] **6. `desktop.yml` CI.** Weekly cron matching `publish.yml`, updater
      keypair in Actions secrets, first GitHub Release with a `latest.json`.
- [x] **7. Hosted site.** `UNSTREAM_YOUTUBE_DISABLED` in `compose.dokploy.yml`,
      the get-the-app banner, README and `README.fa.md`.

### Decisions already made, so they don't get relitigated

| Question | Answer | Because |
| --- | --- | --- |
| Shell | Tauri v2 | System webview; the Python payload is heavy enough already |
| Who serves the SPA | FastAPI, over `127.0.0.1` | Keeps `api.ts` untouched, keeps the service worker working, no new CORS |
| Finding ffmpeg / deno | `PATH` on the spawned process | `shutil.which` is already how both are found — no Python change |
| PO token sidecar | Not bundled | A datacenter-IP problem; the `POT_PROVIDER_URL` seam stays |
| The hosted instance | Stays up, metadata + SoundCloud | None of that is IP-blocked |
| Mobile | Not planned | Desktop-first local app |
