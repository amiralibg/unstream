"""Songs like this one — what autoplay queues when the queue runs out.

Deezer is the only keyless catalog with a notion of "similar": every artist
has a public radio (`/artist/{id}/radio`), a mix of the artist and the ones
its listeners also play, and a list of related artists. Smaller artists
often have neither, so the last resort is the artist's own top tracks. A song from any
source is first found on Deezer by plain search — the advanced
`artist:"…" track:"…"` syntax returns nothing for a good share of titles,
Persian ones included — and its artist's radio is the answer. A radio too
short to fill a queue is topped up from related artists' top tracks.

The seed itself and anything sharing its title are left out, and each song
is marked with its library file when it is already on disk, so autoplay
plays the file rather than streaming a copy of it.

When Deezer has too little to say — a Persian artist filed under a script
nobody searches by is the usual case — the fallback is YouTube's own "Mix"
for the song (`list=RD<video id>`), the radio YouTube itself autoplays. It
covers anything YouTube has, at the cost of a search and a playlist read,
and its songs come with their upload attached, so they stream without
another search. Only its first entries are read: a mix is effectively
endless, and paging through all of it took over a minute.
"""

import os
import random
import re
from concurrent.futures import ThreadPoolExecutor

from yt_dlp import YoutubeDL

from . import deezer, downloader, playlists, ytdlp
from .models import ProviderError, Track

RADIO_SIZE = 40
MAX_RESULTS = 25
# Fewer than this from Deezer and the YouTube mix is asked instead.
ENOUGH = 8


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", " ", text.casefold()).strip()


def _lead(artist: str) -> str:
    return _norm(re.split(r"\s*(?:,|&|;|/|\bfeat\.?|\bft\.?|،)\s*", artist, maxsplit=1)[0])


def _artist_id(title: str, artist: str) -> str | None:
    """The Deezer artist behind a song, found by searching for the song and
    accepting the first hit whose artist is the one we were given — then,
    failing that, by searching for the artist alone."""
    lead = _lead(artist)
    if title:
        query = f"{artist} {title}".strip()
        hits = deezer._get("/search/track", q=query, limit=10).get("data") or []
        for hit in hits:
            name = (hit.get("artist") or {}).get("name", "")
            if not lead or _lead(name) == lead:
                return str(hit["artist"]["id"])
    if artist:
        found = deezer._get("/search/artist", q=artist, limit=5).get("data") or []
        for hit in found:
            if _lead(hit.get("name", "")) == lead:
                return str(hit["id"])
        if found:
            return str(found[0]["id"])
    return None


def _data(path: str, **params) -> list[dict]:
    """A list endpoint, with Deezer's "no data" error read as an empty list:
    a radio or a related-artists list simply doesn't exist for many smaller
    artists — Persian ones especially — and that is not a failure."""
    try:
        return deezer._get(path, **params).get("data") or []
    except ProviderError as exc:
        if "no data" in str(exc).lower():
            return []
        raise


def _related_tops(artist_id: str, wanted: int) -> list[dict]:
    related = _data(f"/artist/{artist_id}/related", limit=6)
    if not related:
        return []
    with ThreadPoolExecutor(max_workers=len(related)) as pool:
        pages = list(
            pool.map(
                lambda a: _data(f"/artist/{a['id']}/top", limit=4),
                related,
            )
        )
    # Interleaved, so the top-up isn't six songs by the first related artist.
    mixed = [item for round_ in zip(*pages) for item in round_]
    return mixed[:wanted]


def _deezer(title: str, artist: str, limit: int) -> list[Track]:
    artist_id = _artist_id(title, artist)
    if artist_id is None:
        return []
    items = _data(f"/artist/{artist_id}/radio", limit=RADIO_SIZE)
    if len(items) < limit:
        items += _related_tops(artist_id, limit - len(items))
    if len(items) < limit:
        # No radio and no relatives: the artist's own best-known songs are
        # still a better next song than silence.
        items += _data(f"/artist/{artist_id}/top", limit=limit)
    return [deezer._track_from_api(item) for item in items]


def _youtube_disabled() -> bool:
    return os.getenv("UNSTREAM_YOUTUBE_DISABLED", "").lower() in ("1", "true", "yes")


def _youtube_mix(title: str, artist: str, limit: int) -> list[Track]:
    seed = Track(id="seed", title=title, artists=[artist] if artist else [], album="", duration_ms=0, cover_url=None)
    page = downloader.search_source(seed, prefix="ytsearch5")
    video = re.search(r"(?:v=|youtu\.be/)([\w-]{11})", page)
    if not video:
        return []
    vid = video.group(1)
    opts = ytdlp.base_opts(
        extract_flat="in_playlist",
        skip_download=True,
        playlistend=limit + 1,
        retries=2,
        socket_timeout=15,
    )
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}&list=RD{vid}", download=False)
    entries = [e for e in (info or {}).get("entries") or [] if e and e.get("id") != vid]
    return [ytdlp._track_from_entry(e, position=i) for i, e in enumerate(entries, 1)]


def similar(title: str, artist: str, limit: int = MAX_RESULTS) -> list[dict]:
    """Up to `limit` songs in the spirit of (title, artist), as track dicts
    with `file_id` set when the song is already in the library."""
    found = _deezer(title, artist, limit)
    if len(found) < ENOUGH and not _youtube_disabled():
        try:
            found += _youtube_mix(title, artist, limit)
        except Exception:  # noqa: BLE001 — a fallback that fails leaves what Deezer gave
            pass
    if not found:
        raise ProviderError("Could not find anything to suggest from this song")

    seed = _norm(title)
    seen: set[tuple[str, str]] = set()
    tracks: list[Track] = []
    for track in found:
        key = (_norm(track.title), _lead(track.artists[0] if track.artists else ""))
        if key[0] == seed or key in seen:
            continue
        seen.add(key)
        tracks.append(track)
    # The radio leads with the artist's own hits; a light shuffle keeps two
    # sessions from the same seed sounding identical.
    random.shuffle(tracks)
    tracks = tracks[:limit]

    files = playlists.on_disk(
        [{"title": t.title, "artists": t.artists, "duration_ms": t.duration_ms} for t in tracks]
    )
    return [
        {
            "id": t.id,
            "title": t.title,
            "artists": t.artists,
            "album": t.album,
            "duration_ms": t.duration_ms,
            "cover_url": t.cover_url,
            "source_url": t.source_url,
            "file_id": file_id,
        }
        for t, file_id in zip(tracks, files)
    ]
