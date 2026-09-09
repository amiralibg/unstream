"""Resolve and search YouTube / SoundCloud through yt-dlp — no key, no account.

yt-dlp already knows how to read public YouTube and SoundCloud pages, so the
same dependency that fetches the audio can also act as a metadata provider:

  * resolve():  a video / track / playlist / set / album URL -> Collection
  * search_youtube() / search_soundcloud():  text query -> SearchResults

Tracks resolved here carry `source_url`, so the downloader grabs that exact
page instead of running a YouTube search for a match.
"""

import os
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError as YtdlpError

from .models import Collection, ProviderError, SearchResult, Track

# YouTube bot-checks datacenter IPs ("Sign in to confirm you're not a bot")
# long before it bothers a home connection, which is why downloads can work
# locally and fail on a VPS. Three answers to that, all configured from the
# environment, so a server that starts failing needs a restart rather than a
# release.
#
# The first is the JS challenge solver. YouTube's player hands out challenges
# that have to be *executed* to turn a format into a URL, and yt-dlp needs two
# things to do it: a JavaScript runtime (deno, in the Dockerfile) and the
# solver script itself, which it declines to fetch unless asked. Without the
# script the runtime alone is useless — yt-dlp reports "Signature solving
# failed" and returns a video with no audio streams on it. It is off by
# default upstream because it downloads code at runtime; that trade is worth
# making here and nowhere near the trade the cookie below asks for.
REMOTE_COMPONENTS = os.getenv("YTDLP_REMOTE_COMPONENTS", "ejs:github")

# The second is a proof-of-origin token provider: a sidecar that mints the
# tokens YouTube wants from clients it trusts, with no account and no API key
# behind it. bgutil-ytdlp-pot-provider is installed as a yt-dlp plugin (see
# pyproject.toml) and sits inert until this names a provider to ask, which is
# what keeps a local checkout working with nothing running beside it.
POT_PROVIDER_URL = os.getenv("POT_PROVIDER_URL", "").rstrip("/")

# Where the solver script and player caches land. Worth a volume: without one
# every container restart re-downloads them on the first extraction of the
# day, which is slow and noisy rather than broken.
CACHE_DIR = os.getenv("YTDLP_CACHE_DIR", "")

# The third is a cookies.txt exported from a signed-in browser. On a VPS this
# is not the last resort it reads like: YouTube answers a flagged address with
# LOGIN_REQUIRED at the playability check, before a token is asked for and
# before a challenge exists to solve, so neither of the two above ever gets to
# help. The cost is tying every download to one account — YouTube bans
# accounts for exactly this, so it wants a throwaway, not a real one.
#
# A path that isn't there is ignored rather than passed on — a stale variable
# would otherwise fail every extraction the process ever makes. That failure
# used to be silent, which made a missing mount look exactly like a mount
# that wasn't helping; status() below is how an operator tells them apart.
COOKIEFILE = os.getenv("YTDLP_COOKIEFILE", "")
COOKIEFILE_MISSING = bool(COOKIEFILE) and not Path(COOKIEFILE).is_file()
if COOKIEFILE_MISSING:
    COOKIEFILE = ""


def _writable_cookiefile(source: str) -> str:
    """Return a copy of `source` that yt-dlp is allowed to write back to.

    YouTube rotates these cookies as they are spent, and yt-dlp saves the new
    ones when it closes — into the same file it read them from. That makes a
    read-only cookie file worse than no cookie at all: extraction succeeds,
    close() raises PermissionError afterwards, and since that is not a
    ProviderError it leaves as a 500 with the real cause buried in a traceback.

    Which is exactly what a mounted file is. Dokploy writes its File Mounts as
    root while the container runs as appuser, and chown would only hold until
    the next deploy rewrote it. So the mount is treated as a seed rather than
    as the session: it is copied onto the cache volume and the rotation happens
    there, where it also survives a restart. Editing the file in Dokploy takes
    effect on the next boot, because the copy is refreshed whenever the mount
    is the newer of the two.
    """
    if os.access(source, os.W_OK):
        return source  # a local checkout owns its own cookies.txt
    live = Path(CACHE_DIR or tempfile.gettempdir()) / "cookies.live.txt"
    try:
        seed = Path(source)
        if not live.exists() or seed.stat().st_mtime > live.stat().st_mtime:
            live.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(seed, live)
            live.chmod(0o600)
        return str(live)
    except OSError:
        # Nowhere writable to put it. Handing back the read-only original
        # would trade this for a 500 on every extraction, so the cookie is
        # dropped instead and status() reports the difference.
        return ""


COOKIEFILE_LIVE = _writable_cookiefile(COOKIEFILE) if COOKIEFILE else ""


# Browsers yt-dlp can read cookies out of (`--cookies-from-browser`). On a
# server this would tie every download to one account; on a desktop it is the
# person's own browser and their own account, which makes it the highest-hit
# fix for a bot check that survives the solver and the token provider below.
# A name outside the allowlist is ignored — the value travels from a settings
# dropdown, but the endpoint takes a string and yt-dlp would hand an unknown
# one to an OS-specific reader.
BROWSER_ALLOWLIST = (
    "chrome",
    "chromium",
    "brave",
    "edge",
    "firefox",
    "safari",
    "opera",
    "vivaldi",
)


def _env_browser() -> str:
    name = os.getenv("YTDLP_COOKIES_FROM_BROWSER", "").strip().lower()
    return name if name in BROWSER_ALLOWLIST else ""


# Runtime override from /api/desktop/config; None means "follow the env".
_cookies_from_browser: str | None = None


def set_cookies_from_browser(name: str) -> str:
    """Live-switch the browser cookies are read from. Empty clears it."""
    cleaned = (name or "").strip().lower()
    if cleaned and cleaned not in BROWSER_ALLOWLIST:
        raise ValueError(f"Unsupported browser: {name!r}")
    global _cookies_from_browser
    _cookies_from_browser = cleaned
    return cleaned


def cookies_from_browser() -> str:
    if _cookies_from_browser is not None:
        return _cookies_from_browser
    return _env_browser()


# Which YouTube player clients to try, in order (`tv,web`). The default is
# "whatever yt-dlp tries" — pinning this is how a desktop that starts failing
# gets un-broken without a release, and the launcher sets a desktop default.
# Operator-controlled like every other env here: a typo surfaces in yt-dlp's
# own client error, so values pass through and only empties are dropped.
def player_clients() -> list[str]:
    clients = [
        c.strip().lower()
        for c in os.getenv("YTDLP_PLAYER_CLIENTS", "").split(",")
    ]
    return [c for c in clients if c]


def is_desktop() -> bool:
    return os.getenv("UNSTREAM_DESKTOP", "").lower() in ("1", "true", "yes")


def base_opts(**extra) -> dict:
    """Options every yt-dlp call in the project shares."""
    opts = {"quiet": True, "no_warnings": True, **extra}
    if REMOTE_COMPONENTS:
        opts["remote_components"] = REMOTE_COMPONENTS.split(",")
    # yt-dlp only auto-enables deno as its JS runtime; bun and node exist but
    # are ignored unless named. A machine with bun and no deno (a laptop, say)
    # would otherwise solve no challenges and get videos with missing formats.
    runtime = _js_runtime()
    if runtime and runtime != "deno":
        opts["js_runtimes"] = {runtime: {}}
    if CACHE_DIR:
        opts["cachedir"] = CACHE_DIR
    if COOKIEFILE_LIVE:
        opts["cookiefile"] = COOKIEFILE_LIVE
    browser = cookies_from_browser()
    if browser:
        # yt-dlp reads the live store at extraction time, so switching
        # browsers takes effect on the next download with no restart.
        opts["cookiesfrombrowser"] = (browser,)
    # Copied rather than mutated: `extra` belongs to the caller, and the
    # dict inside it would outlive this call.
    args = dict(opts.get("extractor_args") or {})
    if POT_PROVIDER_URL:
        args["youtubepot-bgutilhttp"] = {"base_url": [POT_PROVIDER_URL]}
    clients = player_clients()
    if clients:
        args["youtube"] = {**dict(args.get("youtube") or {}), "player_client": clients}
    if args:
        opts["extractor_args"] = args
    return opts


def bot_check_message() -> str:
    """What a bot-check failure tells the person who can act on it.

    The server copy names the env var because its operator is the reader. The
    desktop copy names the Settings toggle because the reader is the person
    whose browser holds the fix.
    """
    if is_desktop():
        return (
            "YouTube asked for a sign-in to confirm this download is not a bot, "
            "so the audio could not be fetched. Open Settings → Browser cookies "
            "and pick the browser you are signed into YouTube in, then try again."
        )
    return (
        "YouTube asked this server to sign in to confirm it is not a bot, so the "
        "audio could not be fetched. Datacenter and VPN addresses get this long "
        "before a home connection does. Point YTDLP_COOKIEFILE at a cookies.txt "
        "exported from a signed-in throwaway account to get past it."
    )


def status() -> dict:
    """What the anti-bot configuration actually resolved to, for /api/admin."""
    return {
        "remote_components": REMOTE_COMPONENTS or None,
        "js_runtime": _js_runtime(),
        "pot_provider_url": POT_PROVIDER_URL or None,
        "cache_dir": CACHE_DIR or None,
        "cookies_from_browser": cookies_from_browser() or None,
        "player_clients": player_clients() or None,
        "cookiefile": COOKIEFILE or None,
        # True means YTDLP_COOKIEFILE was set and pointed at nothing: almost
        # always a mount that didn't happen.
        "cookiefile_missing": COOKIEFILE_MISSING,
        # The copy yt-dlp is actually handed. Equal to the above when the file
        # was already writable; null beside a set `cookiefile` means there was
        # nowhere to put a writable copy, and the cookie is being ignored
        # rather than crashing every extraction on the way out.
        "cookiefile_live": COOKIEFILE_LIVE or None,
        "youtube_disabled": os.getenv("UNSTREAM_YOUTUBE_DISABLED", "").lower()
        in ("1", "true", "yes"),
    }


def _js_runtime() -> str | None:
    """Which JS runtime is on PATH, if any — None means challenges can't be
    solved and YouTube will hand back videos with no audio on them."""
    for runtime in ("deno", "bun", "node", "quickjs"):
        if shutil.which(runtime):
            return runtime
    return None


_YOUTUBE_RE = re.compile(
    r"(?:music\.|www\.|m\.)?(?:youtube\.com/(?:watch\?|playlist\?|shorts/)|youtu\.be/)"
)
_SOUNDCLOUD_RE = re.compile(r"(?:www\.|m\.|on\.)?soundcloud\.com/")

# Noise commonly appended to YouTube titles that has no place in an ID3 tag.
_TITLE_NOISE_RE = re.compile(
    r"""[\(\[\|]?\s*
        (official\s+(music\s+)?(video|audio|visualizer|lyric\s+video)
        |lyrics?\s*(video)?
        |audio|visuali[sz]er|videoclip|clip\s+officiel
        |h[dq]|4k|full\s+album)
        \s*[\)\]\|]?\s*$""",
    re.IGNORECASE | re.VERBOSE,
)


def is_youtube_url(url: str) -> bool:
    return _YOUTUBE_RE.search(url) is not None


def is_soundcloud_url(url: str) -> bool:
    return _SOUNDCLOUD_RE.search(url) is not None


def is_supported_url(url: str) -> bool:
    return is_youtube_url(url) or is_soundcloud_url(url)


def _extract(url_or_query: str, *, flat: bool = True) -> dict:
    opts = base_opts(
        extract_flat="in_playlist" if flat else False,
        skip_download=True,
        retries=2,
        socket_timeout=15,
    )
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url_or_query, download=False)
    except YtdlpError as exc:
        raise ProviderError(f"Could not read that page: {exc}") from exc
    if not info:
        raise ProviderError("That page had no readable media on it.")
    return info


def _clean_title(title: str) -> str:
    cleaned = title
    for _ in range(3):  # titles stack suffixes: "... (Lyrics) [HD]"
        stripped = _TITLE_NOISE_RE.sub("", cleaned).strip(" -–—")
        if stripped == cleaned or not stripped:
            break
        cleaned = stripped
    return cleaned or title


def _clean_uploader(name: str) -> str:
    name = re.sub(r"\s*-\s*Topic$", "", name)  # YouTube Music auto-channels
    name = re.sub(r"VEVO$", "", name)
    return name.strip()


def _entry_artist_title(entry: dict) -> tuple[str, str]:
    """Best-effort (artist, title) from a video/track entry."""
    title = _clean_title(entry.get("title") or "Unknown")
    artist = (
        entry.get("artist")
        or entry.get("creator")
        or _clean_uploader(entry.get("uploader") or entry.get("channel") or "")
    )
    # "Artist - Title" uploads are the norm on YouTube; prefer the split
    # whenever the title itself names the artist.
    if " - " in title:
        left, right = title.split(" - ", 1)
        if left.strip() and right.strip():
            return left.strip(), right.strip()
    return artist or "Unknown", title


def _thumbnail(entry: dict) -> str | None:
    if entry.get("thumbnail"):
        return entry["thumbnail"]
    thumbs = entry.get("thumbnails") or []
    if thumbs:
        return max(thumbs, key=lambda t: (t.get("width") or 0)).get("url")
    return None


def _entry_url(entry: dict) -> str:
    return entry.get("webpage_url") or entry.get("url") or ""


def _track_from_entry(entry: dict, album: str = "", position: int = 0) -> Track:
    artist, title = _entry_artist_title(entry)
    return Track(
        id=str(entry.get("id") or _entry_url(entry) or position),
        title=title,
        artists=[artist],
        album=album,
        duration_ms=int(float(entry.get("duration") or 0) * 1000),
        cover_url=_thumbnail(entry),
        track_number=position,
        release_date=str(entry.get("upload_date") or "")[:4],
        source_url=_entry_url(entry),
    )


def resolve(url: str) -> Collection:
    info = _extract(url)

    if info.get("_type") == "playlist" or "entries" in info:
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise ProviderError("That playlist appears to be empty or private.")
        # Profile pages resolve as "Username (All)" / "(Tracks)" — drop the tab.
        name = re.sub(
            r"\s*\((?:All|Tracks|Popular tracks)\)$",
            "",
            info.get("title") or "Playlist",
        )
        owner = _clean_uploader(info.get("uploader") or info.get("channel") or "")
        if not owner:
            owner = next(
                (
                    _clean_uploader(e.get("uploader") or e.get("channel") or "")
                    for e in entries
                    if e.get("uploader") or e.get("channel")
                ),
                name,  # a profile page's tracks belong to the profile itself
            )
        # SoundCloud albums are "sets" too; treat sets/playlists alike.
        tracks = [
            _track_from_entry(entry, album=name, position=i)
            for i, entry in enumerate(entries, start=1)
        ]
        for track in tracks:
            # Flat entries don't always name their uploader — inherit it.
            if track.artists in ([], ["Unknown"]) and owner:
                track.artists = [owner]
        cover = _thumbnail(info) or next(
            (t.cover_url for t in tracks if t.cover_url), None
        )
        return Collection(
            kind="playlist",
            name=name,
            owner=owner,
            cover_url=cover,
            tracks=tracks,
        )

    track = _track_from_entry(info)
    return Collection(
        kind="track",
        name=track.title,
        owner=", ".join(track.artists),
        cover_url=track.cover_url,
        tracks=[track],
    )


def _search(
    prefix: str, source: str, query: str, limit: int, offset: int = 0
) -> list[SearchResult]:
    # `ytsearchN:` / `scsearchN:` only take a count, never a start position —
    # paging means asking for everything through the end of the page and
    # dropping the head. Flat extraction keeps that cheap.
    try:
        info = _extract(f"{prefix}{offset + limit}:{query}")
    except ProviderError:
        return []  # search is aggregated; one silent source is fine
    results = []
    for entry in (info.get("entries") or [])[offset:]:
        if not entry:
            continue
        # Skip obvious non-songs (mixes, full concerts) and unplayable rows.
        duration = entry.get("duration")
        if duration and duration > 25 * 60:
            continue
        artist, title = _entry_artist_title(entry)
        results.append(
            SearchResult(
                kind="track",
                id=str(entry.get("id") or _entry_url(entry)),
                name=title,
                subtitle=artist,
                cover_url=_thumbnail(entry),
                url=_entry_url(entry),
                source=source,
            )
        )
    return results


# Per-page quota. Every page re-extracts from the top (see _search), so the
# cost grows linearly with depth — past this point yt-dlp would eat the whole
# search budget and starve the catalog APIs, so it bows out and they page on.
PAGE_QUOTA = 12
MAX_DEPTH = 36


def search_youtube(query: str, page: int = 0) -> list[SearchResult]:
    offset = page * PAGE_QUOTA
    if offset >= MAX_DEPTH:
        return []
    return _search("ytsearch", "youtube", query, PAGE_QUOTA, offset)


def search_soundcloud(query: str, page: int = 0) -> list[SearchResult]:
    offset = page * PAGE_QUOTA
    if offset >= MAX_DEPTH:
        return []
    return _search("scsearch", "soundcloud", query, PAGE_QUOTA, offset)


def search(query: str, page: int = 0) -> list[SearchResult]:
    """YouTube and SoundCloud searched concurrently."""
    with ThreadPoolExecutor(max_workers=2) as pool:
        yt = pool.submit(search_youtube, query, page)
        sc = pool.submit(search_soundcloud, query, page)
    return yt.result() + sc.result()
