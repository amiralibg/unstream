"""Play a song that is not on disk: find its audio and relay it to the player.

The same search the downloader runs picks the upload, yt-dlp turns that page
into a direct media URL, and the bytes come through this process on the way
to the `<audio>` element. Relaying rather than handing the webview the URL
is not optional:

  * The webview does not follow the app's connection setting. Everything
    else goes out through `net.py` — the proxy, the VPN on a SOCKS port —
    and a stream that went direct would fail for exactly the people that
    setting exists for.
  * YouTube's media URLs are tied to the headers they were issued with, and
    an `<audio>` element cannot be told to send any.

Upstream ranges are asked for in bounded chunks, never "everything from
here": googlevideo throttles or cuts off an open-ended request, which is the
same reason yt-dlp itself downloads in chunks. The browser takes a 206 that
covers less than it asked for and simply asks again.

A resolved source is cached per song until shortly before its URL expires,
because the player asks for many ranges of one song and resolution takes
seconds; a URL that turns out to be dead is dropped and resolved once more.

Some uploads have no single-file stream at all — SoundCloud serves most of
its catalogue as HLS, a playlist of segments a relay cannot pass through as
one URL. Those are fetched whole into a small cache first (a song is a few
MB, and yt-dlp joins the segments) and served from there, ranges included.

Desktop only, like playlists, unless `UNSTREAM_STREAMING` says otherwise: on
a server the bytes would cross its bandwidth for every listener, and
YouTube refuses datacenter addresses before any of this gets a turn.
"""

import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from yt_dlp.utils import DownloadError

from . import downloader, ytdlp
from .models import Track
from .ytdlp import base_opts

# Progressive formats only. HLS and DASH are playlists of fragments, which a
# single relayed URL cannot carry; m4a first because every webview this app
# ships in can decode AAC, while Opus-in-WebM is patchy on WebKit.
FORMAT = (
    "bestaudio[ext=m4a][protocol^=http]/bestaudio[acodec=mp3][protocol^=http]"
    "/bestaudio[protocol^=http]/best[protocol^=http]"
)

CHUNK_BYTES = 4 * 1024 * 1024
_READ_BYTES = 64 * 1024
_CACHE_SIZE = 256
_DEFAULT_TTL = 3600
_EXPIRY_MARGIN = 300

# Songs fetched whole because they had no single-file stream. Small, and
# trimmed to the most recent few, since each is a song someone just played.
CACHE_DIR = Path(
    os.getenv("UNSTREAM_STREAM_CACHE", Path(tempfile.gettempdir()) / "unstream-stream")
)
CACHE_FILES = 40
_CACHED_TTL = 6 * 3600

_MEDIA_TYPES = {
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "mp3": "audio/mpeg",
    "webm": "audio/webm",
    "opus": "audio/ogg",
    "ogg": "audio/ogg",
    "aac": "audio/aac",
}


def enabled() -> bool:
    raw = os.getenv("UNSTREAM_STREAMING", "").lower()
    if raw in ("1", "true", "yes"):
        return True
    if raw in ("0", "false", "no"):
        return False
    return os.getenv("UNSTREAM_DESKTOP", "").lower() in ("1", "true", "yes")


class StreamError(Exception):
    """No playable audio could be found or reached for this song."""


@dataclass
class Source:
    url: str
    headers: dict
    ext: str
    expires: float
    # Set when the song was fetched whole into the cache: served from disk.
    path: Path | None = None

    @property
    def media_type(self) -> str:
        return _MEDIA_TYPES.get(self.ext, "application/octet-stream")


_cache: "OrderedDict[str, Source]" = OrderedDict()
_cache_lock = threading.Lock()
# One resolution per song at a time: the player's first range request and a
# prefetch for the same song otherwise both pay for a search.
_key_locks: dict[str, threading.Lock] = {}


def key_for(track: Track) -> str:
    artist = ", ".join(track.artists).casefold().strip()
    return "|".join(
        (track.source_url or "", artist, track.title.casefold().strip(), str(track.duration_ms // 1000))
    )


def _expiry(url: str) -> float:
    """When a media URL stops working. googlevideo says so in `expire`;
    anything else gets an hour, which is shorter than any host we've seen."""
    try:
        raw = parse_qs(urlparse(url).query).get("expire", [""])[0]
        if raw.isdigit():
            return float(raw) - _EXPIRY_MARGIN
    except ValueError:
        pass
    return time.time() + _DEFAULT_TTL


def _trim_cache() -> None:
    try:
        files = sorted(CACHE_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return
    for old in files[CACHE_FILES:]:
        old.unlink(missing_ok=True)


def _fetch_whole(page_url: str) -> Source:
    """The song downloaded into the cache, for uploads that only offer
    segmented (HLS) streams. No re-encode: the audio is kept as it came."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", page_url)[-80:]
    opts = base_opts(
        format="bestaudio/best",
        outtmpl=str(CACHE_DIR / f"{stem}.%(ext)s"),
        noplaylist=True,
        retries=3,
        socket_timeout=15,
        overwrites=True,
        noprogress=True,
    )
    info = ytdlp.run(opts, lambda ydl: ydl.extract_info(page_url, download=True))
    path = Path(info["requested_downloads"][0]["filepath"]) if info.get("requested_downloads") else None
    if path is None or not path.is_file():
        raise StreamError("The audio could not be fetched")
    _trim_cache()
    return Source(
        url="",
        headers={},
        ext=path.suffix.lstrip(".").lower(),
        expires=time.time() + _CACHED_TTL,
        path=path,
    )


def _extract(page_url: str) -> Source:
    opts = base_opts(
        format=FORMAT,
        noplaylist=True,
        skip_download=True,
        retries=2,
        socket_timeout=15,
    )
    try:
        info = ytdlp.run(opts, lambda ydl: ydl.extract_info(page_url, download=False))
    except DownloadError as exc:
        if "Requested format is not available" not in str(exc):
            raise
        return _fetch_whole(page_url)
    if not info or not info.get("url"):
        raise StreamError("No playable format on that page")
    media = info["url"]
    return Source(
        url=media,
        headers=dict(info.get("http_headers") or {}),
        ext=(info.get("ext") or "").lower(),
        expires=_expiry(media),
    )


def _find(track: Track) -> Source:
    """The track's own page if it has one, then YouTube, then SoundCloud —
    the downloader's order, so streaming and downloading pick the same
    recording."""
    tried: set[str] = set()
    last: Exception | None = None
    plans = []
    if track.source_url:
        plans.append(lambda: track.source_url)
    plans.append(lambda: downloader.search_source(track, exclude=tried, prefix="ytsearch8"))
    plans.append(lambda: downloader.search_source(track, exclude=tried, prefix="scsearch5"))
    for plan in plans:
        page = None
        try:
            page = plan()
            if page in tried:
                continue
            return _extract(page)
        except Exception as exc:  # noqa: BLE001 — every source failure is "try the next"
            last = exc
            if page:
                tried.add(page)
    raise StreamError(f"Could not find this song to play: {last}")


def resolve(track: Track, *, fresh: bool = False) -> Source:
    key = key_for(track)
    with _cache_lock:
        lock = _key_locks.setdefault(key, threading.Lock())
    with lock:
        with _cache_lock:
            hit = _cache.get(key)
            if hit and not fresh and hit.expires > time.time():
                _cache.move_to_end(key)
                return hit
        source = _find(track)
        with _cache_lock:
            _cache[key] = source
            _cache.move_to_end(key)
            while len(_cache) > _CACHE_SIZE:
                old, _ = _cache.popitem(last=False)
                _key_locks.pop(old, None)
        return source


_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _bounded(range_header: str | None) -> str:
    """The browser's range, capped at one chunk. A suffix range ("the last N
    bytes", which is how a player reads an MP4 index stored at the end) is
    passed through as it is — it is already bounded."""
    match = _RANGE.match((range_header or "").strip())
    if not match:
        return f"bytes=0-{CHUNK_BYTES - 1}"
    start, end = match.groups()
    if not start:
        return f"bytes=-{end}" if end else f"bytes=0-{CHUNK_BYTES - 1}"
    first = int(start)
    last = first + CHUNK_BYTES - 1
    if end:
        last = min(last, int(end))
    return f"bytes={first}-{last}"


@dataclass
class Relay:
    status: int
    headers: dict
    body: Iterator[bytes]


def _open(source: Source, byte_range: str):
    request = urllib.request.Request(source.url, headers={**source.headers, "Range": byte_range})
    return urllib.request.urlopen(request, timeout=20)


def _from_file(source: Source, byte_range: str) -> Relay:
    """A cached song, served with the same ranges a relay would answer."""
    path = source.path
    size = path.stat().st_size
    start, _, end = byte_range.removeprefix("bytes=").partition("-")
    if not start:
        first, last = max(0, size - int(end or 0)), size - 1
    else:
        first, last = int(start), min(int(end) if end else size - 1, size - 1)
    if first >= size:
        raise StreamError("Range past the end of the song")
    length = last - first + 1

    def body() -> Iterator[bytes]:
        with path.open("rb") as handle:
            handle.seek(first)
            left = length
            while left > 0 and (chunk := handle.read(min(_READ_BYTES, left))):
                left -= len(chunk)
                yield chunk

    return Relay(
        status=206,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Length": str(length),
            "Content-Range": f"bytes {first}-{last}/{size}",
            "Content-Type": source.media_type,
        },
        body=body(),
    )


def open_relay(track: Track, range_header: str | None) -> Relay:
    """Open the song at the requested range, re-resolving once if the cached
    URL has gone stale under us (403/404/410 from the media host)."""
    byte_range = _bounded(range_header)
    source = resolve(track)
    if source.path is not None:
        if not source.path.is_file():
            source = resolve(track, fresh=True)
        if source.path is not None:
            return _from_file(source, byte_range)
    try:
        upstream = _open(source, byte_range)
    except urllib.error.HTTPError as exc:
        if exc.code == 416:
            raise
        if exc.code not in (403, 404, 410):
            raise StreamError(f"The audio host answered {exc.code}") from exc
        source = resolve(track, fresh=True)
        upstream = _open(source, byte_range)
    except OSError as exc:
        raise StreamError(f"Could not reach the audio host: {exc}") from exc

    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    for name in ("Content-Length", "Content-Range"):
        value = upstream.headers.get(name)
        if value:
            headers[name] = value
    status = upstream.status
    if status == 200 and headers.get("Content-Range"):
        status = 206

    def body() -> Iterator[bytes]:
        with upstream:
            while chunk := upstream.read(_READ_BYTES):
                yield chunk

    return Relay(status=status, headers=headers | {"Content-Type": source.media_type}, body=body())
