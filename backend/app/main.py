"""Unstream API — resolve music URLs and download their tracks.

Run with:  uvicorn app.main:app --reload --port 8000
"""

import hmac
import io
import os
import re
import zipfile
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, wait
from contextlib import asynccontextmanager
from dataclasses import asdict
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from . import analytics, deezer, downloader, embed, itunes, jobs, limits, lyrics, soundcloud, ytdlp
from .models import Collection, ProviderError, SearchResult

# Every provider here is keyless and free — no accounts, no API credentials.
SEARCH_TIMEOUT_SECONDS = 20


def resolve_any(url: str) -> Collection:
    """Route a URL to the right metadata provider.

    Deezer / Apple Music URLs go to their public JSON APIs; YouTube and
    SoundCloud go through yt-dlp. Spotify URLs go through the public embed
    pages — no account or API key is ever required.
    """
    if deezer.is_deezer_url(url):
        return deezer.resolve(url)
    if itunes.is_itunes_url(url):
        return itunes.resolve(url)
    # SoundCloud via its web API first — yt-dlp flat playlists often omit
    # titles, artwork and duration. Fall back to yt-dlp if the API is unreachable.
    if soundcloud.is_soundcloud_url(url):
        try:
            return soundcloud.resolve(url)
        except ProviderError:
            return ytdlp.resolve(url)
    if ytdlp.is_supported_url(url):
        return ytdlp.resolve(url)
    spotify_ref = embed.parse_url(url)
    if spotify_ref:
        return embed.resolve(*spotify_ref)
    raise ProviderError(
        "Unsupported link — paste a Spotify, Deezer, Apple Music, "
        "YouTube or SoundCloud URL, or search by name instead."
    )


def provider_of(url: str) -> str:
    """Which catalog a pasted link belongs to — an analytics dimension only."""
    if deezer.is_deezer_url(url):
        return "deezer"
    if itunes.is_itunes_url(url):
        return "apple"
    if soundcloud.is_soundcloud_url(url):
        return "soundcloud"
    if ytdlp.is_supported_url(url):
        return "youtube"
    if embed.parse_url(url):
        return "spotify"
    return "unknown"


def _squash(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — for comparing."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def dedup_key(result: SearchResult) -> str:
    """Identity of a result across providers: kind + name + lead artist.

    Sent to the client too, so it can drop cross-page duplicates that no
    single page could have caught on its own.
    """
    artist = _squash(result.subtitle.split("·")[0])
    return f"{result.kind}:{_squash(result.name).replace(' ', '')}:{artist.replace(' ', '')}"


# Catalog APIs carry cleaner metadata than raw user uploads, so an otherwise
# equal match from Deezer outranks the same song ripped to YouTube.
_SOURCE_WEIGHT = {"deezer": 1.0, "itunes": 0.97, "soundcloud": 0.9, "youtube": 0.87}


def relevance(result: SearchResult, query: str) -> float:
    """0–1 score for how well a result answers the query.

    Compared against the name alone *and* against "name + artist", because
    people search both ways ("bohemian rhapsody" and "queen bohemian").
    """
    q = _squash(query)
    name = _squash(result.name)
    both = f"{name} {_squash(result.subtitle)}".strip()

    score = max(
        SequenceMatcher(None, q, name).ratio(),
        SequenceMatcher(None, q, both).ratio(),
    )
    if name == q:
        score = 1.0
    elif name.startswith(q):
        score = max(score, 0.93)
    elif q in name:
        score = max(score, 0.86)
    # Every word of the query appears somewhere in the title or the artist.
    tokens = set(q.split())
    if tokens and tokens <= set(both.split()):
        score = max(score, 0.8)

    return score * _SOURCE_WEIGHT.get(result.source, 0.85)


def search_any(query: str, page: int = 0) -> tuple[list[SearchResult], bool]:
    """Fan out to every free source in parallel and merge one page of results.

    Each provider pages independently (page N asks each for its own Nth
    slice), near-duplicates keep only the higher-quality hit, and what
    survives is ordered by relevance rather than by which provider answered
    first. A slow or failing source never blocks the others.

    Returns the page plus whether it's worth asking for another one.
    """
    def soundcloud_search(q: str, p: int) -> list[SearchResult]:
        try:
            return soundcloud.search(q, p)  # full parity: tracks/people/albums/sets
        except Exception:
            return ytdlp.search_soundcloud(q, p)  # fallback: tracks only

    providers = [deezer.search, itunes.search, soundcloud_search, ytdlp.search_youtube]

    pool = ThreadPoolExecutor(max_workers=len(providers))
    futures = [pool.submit(p, query, page) for p in providers]
    wait(futures, timeout=SEARCH_TIMEOUT_SECONDS)
    # Don't block on stragglers — abandon anything still running.
    pool.shutdown(wait=False, cancel_futures=True)

    merged: list[SearchResult] = []
    seen: set[str] = set()
    errors: list[Exception] = []
    for future in futures:
        if not future.done():
            continue
        if future.exception():
            errors.append(future.exception())
            continue
        for result in future.result():
            key = dedup_key(result)
            if key in seen:
                continue
            seen.add(key)
            merged.append(result)

    if not merged and errors:
        raise ProviderError(f"Search failed: {errors[0]}")

    merged.sort(key=lambda r: relevance(r, query), reverse=True)
    # Nothing came back for this page, so there is nothing deeper either.
    return merged, bool(merged)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    analytics.start()
    jobs.start_sweeper()
    yield


app = FastAPI(title="Unstream", version="0.0.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ResolveRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    track_ids: list[str] | None = None  # None = everything
    quality: str = downloader.DEFAULT_QUALITY  # mp3 bitrate, or "original"
    lyrics: bool = True  # embed lyrics in the finished files' tags


# Served files are no longer always mp3 — "original" keeps the upload's own
# container, and the browser needs to be told which one it is getting.
_MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".webm": "audio/webm",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/search")
def search(request: Request, q: str, page: int = 0) -> dict:
    q = q.strip()
    if not q:
        raise HTTPException(status_code=400, detail="Empty search query")
    if page < 0:
        raise HTTPException(status_code=400, detail="Bad page number")
    limits.enforce("search", request)
    try:
        results, has_more = search_any(q, page)
    except ProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # Only the first page counts as "a search" — infinite scroll would
    # otherwise report one curious visitor as five.
    if page == 0:
        analytics.record(
            "search",
            visitor=limits.visitor(request),
            detail="hit" if results else "empty",
            label=" ".join(q.lower().split()),
            value=len(results),
        )
    return {
        "results": [asdict(r) | {"dedup_key": dedup_key(r)} for r in results],
        "page": page,
        "has_more": has_more,
    }


@app.get("/api/artist/{artist_id}")
def artist(request: Request, artist_id: str) -> dict:
    if not artist_id.isdigit():
        raise HTTPException(status_code=400, detail="Bad artist id")
    # One Deezer fetch, same cost profile as opening a link.
    limits.enforce("resolve", request)
    try:
        data = deezer.artist(artist_id)
    except ProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    analytics.record(
        "artist_view",
        visitor=limits.visitor(request),
        source="deezer",
        label=data.get("name"),
    )
    # Same shape as /api/search results, dedup_key included, so the client
    # can render an artist's tracks and albums with the same components.
    for key in ("top_tracks", "albums"):
        data[key] = [asdict(r) | {"dedup_key": dedup_key(r)} for r in data[key]]
    return data


@app.post("/api/resolve")
def resolve(body: ResolveRequest, request: Request) -> dict:
    limits.enforce("resolve", request)
    try:
        collection = resolve_any(body.url)
    except ProviderError as exc:
        analytics.record(
            "resolve_error",
            visitor=limits.visitor(request),
            source=provider_of(body.url),
        )
        raise HTTPException(status_code=400, detail=str(exc))
    analytics.record(
        "resolve",
        visitor=limits.visitor(request),
        source=provider_of(body.url),
        detail=collection.kind,
        label=collection.name,
        value=len(collection.tracks),
    )
    return asdict(collection)


@app.get("/api/lyrics")
def get_lyrics(
    request: Request,
    artist: str = Query(max_length=200),
    title: str = Query(max_length=200),
    album: str = Query("", max_length=200),
    duration_ms: int = 0,
    refresh: bool = False,
) -> dict:
    """Lyrics for a track, keyed by its catalog metadata.

    Always 200, with `status` saying which kind of nothing a null is:

      found        we have the words
      absent       every source answered, none has this song
      unavailable  the sources could not be reached — ask again later

    `absent` and `unavailable` are kept apart on purpose, and collapsing them
    hides source outages in the very numbers meant to reveal them — see
    docs/DESIGN.md. `refresh=1` is what the retry button sends: an outage is
    cached briefly so an album does not re-pay it per track, and a person
    asking again is exactly the caller that cache should not apply to.

    `synced` is only ever non-null when `plain` is, so the UI can treat it as
    a future enhancement and ignore it today.

    The length caps are load-bearing: a miss is cached under a key built from
    these strings, so without them a caller can write rows of arbitrary size
    into lyrics.db. No real catalog title comes close to 200.
    """
    limits.enforce("lyrics", request)
    found = None
    try:
        found = lyrics.fetch(artist, title, album, duration_ms / 1000, force=refresh)
        status = "found" if found else "absent"
    except lyrics.LyricsUnavailable:
        # Not a 500 — the page still renders — but not "absent" either. The
        # sources were unreachable, and saying "this song has no lyrics" would
        # be a claim we cannot make. The client offers a retry on this.
        status = "unavailable"
    analytics.record(
        "lyrics_view",
        visitor=limits.visitor(request),
        detail=status,
        label=f"{artist} - {title}",
    )
    return {
        "status": status,
        "plain": found.plain if found else None,
        "synced": found.synced if found else None,
        "source": found.source if found else None,
    }


@app.post("/api/download")
def download(body: DownloadRequest, request: Request) -> dict:
    if body.quality not in downloader.QUALITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Quality must be one of: {', '.join(downloader.QUALITIES)}",
        )
    client = limits.enforce("download", request)
    # Before resolving: a caller at their limit shouldn't get a provider fetch
    # out of the request that turns them away.
    if limits.MAX_ACTIVE_JOBS > 0 and jobs.active_count(client) >= limits.MAX_ACTIVE_JOBS:
        raise HTTPException(
            status_code=429,
            detail="Too many downloads at once — wait for one to finish.",
        )

    try:
        collection = resolve_any(body.url)
    except ProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    tracks = collection.tracks
    if body.track_ids is not None:
        wanted = set(body.track_ids)
        tracks = [t for t in tracks if t.id in wanted]
    if not tracks:
        raise HTTPException(status_code=400, detail="No tracks to download")
    if limits.MAX_TRACKS_PER_JOB > 0 and len(tracks) > limits.MAX_TRACKS_PER_JOB:
        raise HTTPException(
            status_code=400,
            detail=f"Too many tracks — {limits.MAX_TRACKS_PER_JOB} at a time at most.",
        )

    visitor = limits.visitor(request)
    job = jobs.start(
        collection.name,
        tracks,
        body.quality,
        embed_lyrics=body.lyrics,
        owner=client,
        visitor=visitor,
    )
    analytics.record(
        "download_start",
        visitor=visitor,
        source=provider_of(body.url),
        detail=body.quality,
        label=collection.name,
        value=len(tracks),
    )
    return {"job_id": job.id}


@app.get("/api/jobs")
def job_statuses(ids: str) -> dict:
    """Poll several jobs at once: ?ids=a,b,c

    Unknown ids are omitted rather than raising, so a client restoring a job
    list from a previous session learns which the server has already swept
    without failing the whole poll.
    """
    wanted = [i for i in (part.strip() for part in ids.split(",")) if i][:50]
    return {"jobs": [job.as_dict() for i in wanted if (job := jobs.get(i))]}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    return job.as_dict()


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request) -> dict:
    """Stop a running job. Idempotent, and safe to call on a finished one.

    Not rate limited, on purpose: this is the endpoint that *reduces* what
    the server is doing, and the job id is the same unguessable secret that
    already gates the files. Charging someone to stop their own download
    would be the one limit that costs us more when it bites.
    """
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    stopped = jobs.cancel(job)
    if stopped:
        analytics.record(
            "download_cancel",
            visitor=limits.visitor(request),
            detail=job.quality,
            label=job.name,
            value=stopped,
        )
    return job.as_dict()


@app.get("/api/jobs/{job_id}/tracks/{track_id}/file")
def track_file(job_id: str, track_id: str, request: Request) -> FileResponse:
    limits.enforce("file", request)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    state = job.tracks.get(track_id)
    if not state or state.status != "done" or not state.file_path:
        raise HTTPException(status_code=404, detail="Track not ready")
    # The file leaving the server is the closest thing to "a download" in
    # the sense a user means it — everything before this is just a queue.
    analytics.record(
        "file_save",
        visitor=limits.visitor(request),
        detail=job.quality,
        label=f"{', '.join(state.track.artists)} - {state.track.title}",
    )
    return FileResponse(
        state.file_path,
        media_type=_MEDIA_TYPES.get(
            state.file_path.suffix.lower(), "application/octet-stream"
        ),
        filename=state.file_path.name,
    )


class _ZipSink(io.RawIOBase):
    """Holds what ZipFile writes until the generator can yield it away.

    ZipFile insists on a file object; the response wants an iterator. This
    is the seam. Unseekable on purpose — that makes ZipFile emit each entry
    with a data descriptor instead of rewinding to patch its header, which
    is what allows the archive to be produced in one forward pass.
    """

    def __init__(self) -> None:
        self._chunks: list[bytes] = []

    def writable(self) -> bool:
        return True

    def write(self, data) -> int:  # noqa: ANN001 — memoryview or bytes
        self._chunks.append(bytes(data))
        return len(data)

    def drain(self) -> bytes:
        out = b"".join(self._chunks)
        self._chunks.clear()
        return out


# One track's worth of bytes in flight at a time, not one album's.
_ZIP_CHUNK_BYTES = 256 * 1024


def _zip_chunks(files: list[Path]) -> Iterator[bytes]:
    """Yield a ZIP of `files` as it is built.

    Buffering the whole archive was a memory bomb: a 100-track album at 320
    kbps is a few hundred MB, doubled while the response was assembled, with
    nothing capping how many people asked at once. Stored (not deflated), so
    a file's bytes pass through once and peak memory is one chunk.
    """
    sink = _ZipSink()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED) as zf:
        for path in files:
            try:
                source = path.open("rb")
            except OSError:
                continue  # swept mid-download; the rest of the album is fine
            with source, zf.open(path.name, "w") as entry:
                while chunk := source.read(_ZIP_CHUNK_BYTES):
                    entry.write(chunk)
                    if data := sink.drain():
                        yield data
            if data := sink.drain():
                yield data
    # The central directory, written when ZipFile closed.
    if data := sink.drain():
        yield data


@app.get("/api/jobs/{job_id}/zip")
def job_zip(job_id: str, request: Request) -> Response:
    limits.enforce("zip", request)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    files = [
        s.file_path
        for s in job.tracks.values()
        if s.status == "done" and s.file_path and s.file_path.exists()
    ]
    if not files:
        raise HTTPException(status_code=404, detail="No completed tracks yet")

    analytics.record(
        "zip_download",
        visitor=limits.visitor(request),
        detail=job.quality,
        label=job.name,
        value=len(files),
    )

    # HTTP headers are latin-1 only; non-ASCII names (e.g. "PERSIĀDELICĀ")
    # need the RFC 5987 filename* form with an ASCII fallback.
    name = (job.name or "unstream").replace('"', "").replace("\\", "")
    ascii_name = name.encode("ascii", "ignore").decode().strip() or "unstream"
    disposition = (
        f'attachment; filename="{ascii_name}.zip"; '
        f"filename*=UTF-8''{quote(name)}.zip"
    )
    return StreamingResponse(
        _zip_chunks(files),
        media_type="application/zip",
        headers={"Content-Disposition": disposition},
    )


# --------------------------------------------------------------------------
# Analytics: one beacon in, a token-gated dashboard out.


class CollectRequest(BaseModel):
    """What the browser is allowed to tell us. Everything else is ignored."""

    name: str
    path: str | None = None
    referrer: str | None = None
    device: str | None = None
    standalone: bool = False  # running as an installed PWA
    detail: str | None = None


# The server records everything it can see by itself; these are the few
# things only the browser knows.
_CLIENT_EVENTS = {"page_view", "share", "pwa_install", "install_prompt"}
_DEVICES = {"mobile", "tablet", "desktop"}


def _referrer_host(referrer: str | None, request: Request) -> str | None:
    """Host that sent the visitor, or None for direct and self-referrals."""
    if not referrer:
        return "direct"
    try:
        host = urlparse(referrer).hostname
    except ValueError:
        return None
    if not host or host == request.url.hostname:
        return None  # in-app navigation, not an arrival
    return host[:80]


@app.post("/api/collect", status_code=204)
def collect(body: CollectRequest, request: Request) -> Response:
    """Page views and other browser-only events, from `sendBeacon`.

    Deliberately forgiving: an unknown event name is dropped rather than
    answered with an error, because nothing on the page waits for this
    response and a beacon must never turn into a visible failure.
    """
    limits.enforce("collect", request)
    if body.name in _CLIENT_EVENTS:
        analytics.record(
            body.name,
            surface="pwa" if body.standalone else "web",
            visitor=limits.visitor(request),
            source=_referrer_host(body.referrer, request) if body.name == "page_view" else None,
            detail=body.device if body.device in _DEVICES else body.detail,
            # Query strings can carry a search term; the search event already
            # records those properly, so keep paths to the path.
            label=(body.path or "/").split("?")[0][:120],
        )
    return Response(status_code=204)


ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")


def require_admin(request: Request) -> None:
    """Bearer-token gate. Unset token means the dashboard does not exist."""
    if not ADMIN_TOKEN:
        raise HTTPException(
            status_code=503, detail="Admin dashboard is off — set ADMIN_TOKEN to enable it."
        )
    header = request.headers.get("authorization", "")
    token = header[7:] if header[:7].lower() == "bearer " else ""
    if not hmac.compare_digest(token, ADMIN_TOKEN):
        # Charged only on failure, so normal polling is never throttled.
        limits.enforce("admin", request)
        raise HTTPException(status_code=401, detail="Bad admin token")


@app.get("/api/admin/stats")
def admin_stats(request: Request, days: int = 30) -> dict:
    require_admin(request)
    days = max(1, min(days, analytics.RETENTION_DAYS))
    return analytics.stats(days) | {"live": jobs.live_counts()}


@app.get("/api/admin/events")
def admin_events(request: Request, limit: int = 200) -> dict:
    """Raw event feed — for confirming the wiring works, not for reading."""
    require_admin(request)
    return {"events": analytics.recent(limit)}


@app.get("/api/admin/extraction")
def admin_extraction(request: Request) -> dict:
    """What the anti-bot settings resolved to inside the container.

    Both of them are mounts and environment variables rather than code, so
    the failure they share is arriving at neither: YouTube answers "sign in
    to confirm you're not a bot" the same way whether the provider is
    unreachable, the cookie file never got mounted, or both are fine and the
    IP is simply burnt. This says which of those it is.
    """
    require_admin(request)
    return ytdlp.status()
