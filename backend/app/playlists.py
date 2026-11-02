"""Playlists the person makes themselves, kept in one JSON file on disk.

A playlist entry is catalog metadata — title, artists, album, duration, the
upload it came from — not a library file id. File ids are hashes of a path
under *this* machine's downloads folder, so a playlist made of them would
mean nothing anywhere else. Metadata is what an export can carry to another
device, and it is all the downloader needs to fetch a song that is not on
disk yet. Which entries *are* on disk is worked out on every read, by
matching against the library scan: a file downloaded, renamed or copied in
from elsewhere shows up as playable without the playlist being told.

Stored on disk rather than in the webview's `localStorage`, because that
storage is partitioned by origin and the desktop's origin includes a port
that is re-rolled whenever something else holds it. Settings lost that way
cost a click to restore; a playlist someone spent an evening on does not
come back.

Off unless this is the desktop app (or `UNSTREAM_PLAYLISTS` says otherwise):
one file per process means every visitor of a hosted instance would share
one set of playlists.
"""

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

from . import jobs, library
from .models import Track

PLAYLISTS_PATH = Path(
    os.getenv(
        "PLAYLISTS_PATH", Path(__file__).resolve().parent.parent / "data" / "playlists.json"
    )
)

FORMAT = "unstream.playlist"
FORMAT_VERSION = 1

# Caps on what one file, or one import, can hold. Generous for a real
# collection, and what keeps a malformed import from writing a file the app
# then has to parse on every read.
MAX_PLAYLISTS = 500
MAX_TRACKS = 5000
MAX_IMPORT_BYTES = 5 * 1024 * 1024
_MAX_TEXT = 500
_MAX_NAME = 200

# Where exports land: beside the music, so copying the folder to another
# machine takes its playlists along.
EXPORT_FOLDER = "Playlists"


def enabled() -> bool:
    raw = os.getenv("UNSTREAM_PLAYLISTS", "").lower()
    if raw in ("1", "true", "yes"):
        return True
    if raw in ("0", "false", "no"):
        return False
    return os.getenv("UNSTREAM_DESKTOP", "").lower() in ("1", "true", "yes")


class PlaylistError(Exception):
    """User-facing problem with a playlist request."""


class NotFound(PlaylistError):
    pass


_lock = threading.Lock()


# --------------------------------------------------------------------------
# Storage


def _read() -> list[dict]:
    try:
        raw = json.loads(PLAYLISTS_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        # A file we cannot parse is left where it is for a person to rescue,
        # and never overwritten by an empty list on the next save.
        raise PlaylistError("The playlists file could not be read")
    items = raw.get("playlists") if isinstance(raw, dict) else None
    return [p for p in items or [] if isinstance(p, dict) and p.get("id")]


def _write(playlists: list[dict]) -> None:
    PLAYLISTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Written beside the target and swapped in, so a crash mid-write leaves
    # the previous file rather than half of a new one.
    tmp = PLAYLISTS_PATH.with_suffix(".tmp")
    tmp.write_text(
        json.dumps({"version": FORMAT_VERSION, "playlists": playlists}, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(tmp, PLAYLISTS_PATH)


def _find(playlists: list[dict], playlist_id: str) -> dict:
    for playlist in playlists:
        if playlist["id"] == playlist_id:
            return playlist
    raise NotFound("Unknown playlist")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------
# Cleaning what comes in — from the UI, and from import files written anywhere


def _text(value, limit: int = _MAX_TEXT) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _url(value) -> str | None:
    """Only web addresses. `source_url` is handed to yt-dlp, and a cover is
    put in an <img>; neither has any business with file:// or javascript:."""
    text = _text(value, 2000)
    return text if re.match(r"^https?://", text, re.IGNORECASE) else None


def _relpath(value) -> str:
    """A path inside the music folder, or nothing. Anything that climbs out
    of it is dropped here rather than trusted later."""
    text = _text(value, 1000).replace("\\", "/")
    if not text or text.startswith("/") or re.match(r"^[A-Za-z]:", text):
        return ""
    if any(part in ("", ".", "..") for part in text.split("/")):
        return ""
    return text


def clean_entry(raw: dict) -> dict | None:
    """One playlist row from untrusted input, or None if it names no song."""
    if not isinstance(raw, dict):
        return None
    title = _text(raw.get("title"))
    if not title:
        return None
    artists_raw = raw.get("artists")
    if isinstance(artists_raw, str):
        artists_raw = [artists_raw]
    artists = [a for a in (_text(x) for x in artists_raw or [] if isinstance(x, str)) if a][:20]
    try:
        duration_ms = max(0, min(int(raw.get("duration_ms") or 0), 24 * 3600 * 1000))
    except (TypeError, ValueError):
        duration_ms = 0
    entry = {
        "uid": _new_id(),
        "title": title,
        "artists": artists,
        "album": _text(raw.get("album")),
        "duration_ms": duration_ms,
        # No preview URL: the catalogs sign theirs with an expiry, so one kept
        # in a playlist would be dead within a day.
        "cover_url": _url(raw.get("cover_url")),
        "source_url": _url(raw.get("source_url")),
        "file": _relpath(raw.get("file")),
        "added_at": time.time(),
    }
    # A row added from the library arrives as a file id; it is stored as
    # the path that id stands for, which survives a rescan and an export.
    file_id = raw.get("file_id")
    if not entry["file"] and isinstance(file_id, str) and file_id:
        entry["file"] = library.relative(file_id) or ""
    return entry


def _clean_name(value) -> str:
    return _text(value, _MAX_NAME)


# --------------------------------------------------------------------------
# Matching entries against the library


def _norm(text: str) -> str:
    return re.sub(r"[\W_]+", " ", text.casefold()).strip()


_ARTIST_SPLIT = re.compile(r"\s*(?:,|&|;|/|\bfeat\.?|\bft\.?|\bx\b|،)\s*", re.IGNORECASE)
_DECORATION = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]\s*")


def _lead_artist(text: str) -> str:
    return _norm(_ARTIST_SPLIT.split(text, maxsplit=1)[0]) if text else ""


def _bare_title(title: str) -> str:
    """The title without "(feat. …)", "[Remastered]" and friends — catalogs
    disagree about those far more than about the song's name."""
    return _norm(_DECORATION.sub(" ", title)) or _norm(title)


class _Shelf:
    """The library scan, indexed the three ways an entry can be found."""

    def __init__(self) -> None:
        self.tracks = library.scan()
        self.by_id = {t.id: t for t in self.tracks}
        self.by_rel: dict[str, str] = {}
        self.by_key: dict[tuple[str, str], str] = {}
        self.by_title: dict[str, list[str]] = {}
        # Newest first, like the scan — setdefault keeps the most recent copy
        # when the same song was downloaded twice.
        for t in self.tracks:
            rel = library.relative(t.id)
            if rel:
                self.by_rel[rel] = t.id
            title = _bare_title(t.title)
            self.by_key.setdefault((title, _lead_artist(t.artist)), t.id)
            self.by_title.setdefault(title, []).append(t.id)

    def match(self, entry: dict) -> str | None:
        file_id = self.by_rel.get(entry.get("file") or "")
        if file_id:
            return file_id
        title = _bare_title(entry["title"])
        lead = _lead_artist(entry["artists"][0]) if entry["artists"] else ""
        file_id = self.by_key.get((title, lead))
        if file_id:
            return file_id
        # Same title, different spelling of the artist (scripts, "The"…):
        # accepted only when the length agrees, which a different song of
        # the same name rarely does.
        target = entry.get("duration_ms") or 0
        if target <= 0:
            return None
        for candidate in self.by_title.get(title, []):
            got = self.by_id[candidate].duration_ms
            if got > 0 and abs(got - target) <= 3000:
                return candidate
        return None


def on_disk(songs: list[dict]) -> list[str | None]:
    """The library file for each song, or None — the same matching a
    playlist gets, for songs that aren't in one (autoplay's suggestions)."""
    shelf = _Shelf()
    return [
        shelf.match({"file": "", "artists": [], "duration_ms": 0} | song) for song in songs
    ]


def _annotate(playlist: dict, shelf: _Shelf) -> tuple[dict, bool]:
    """The playlist as the API serves it: every entry told whether it is on
    disk (`file_id`) and what to show as its art (`cover`). Returns whether a
    stored path changed, so the caller can persist what it learned."""
    changed = False
    tracks = []
    for entry in playlist.get("tracks", []):
        file_id = shelf.match(entry)
        local = shelf.by_id.get(file_id) if file_id else None
        if file_id:
            rel = library.relative(file_id) or ""
            if rel and rel != entry.get("file"):
                entry["file"] = rel
                changed = True
        cover = entry.get("cover_url")
        if not cover and local is not None and local.has_cover:
            cover = f"/api/library/cover/{file_id}"
        extra = {"file_id": file_id, "cover": cover}
        # A song added with no length (an M3U line, a bare title) borrows
        # the file's, so the row and the total stop saying "--:--".
        if not entry.get("duration_ms") and local is not None and local.duration_ms:
            extra["duration_ms"] = local.duration_ms
        tracks.append(entry | extra)
    return playlist | {"tracks": tracks}, changed


def _summary(full: dict) -> dict:
    tracks = full["tracks"]
    covers: list[str] = []
    for entry in tracks:
        if entry["cover"] and entry["cover"] not in covers:
            covers.append(entry["cover"])
        if len(covers) == 4:
            break
    return {
        "id": full["id"],
        "name": full["name"],
        "created_at": full.get("created_at", 0),
        "updated_at": full.get("updated_at", 0),
        "count": len(tracks),
        "on_disk": sum(1 for e in tracks if e["file_id"]),
        "duration_ms": sum(e.get("duration_ms") or 0 for e in tracks),
        "covers": covers,
    }


# --------------------------------------------------------------------------
# Operations


def list_all() -> list[dict]:
    with _lock:
        playlists = _read()
        shelf = _Shelf()
        out = []
        dirty = False
        for playlist in playlists:
            full, changed = _annotate(playlist, shelf)
            dirty |= changed
            out.append(_summary(full))
        if dirty:
            _write(playlists)
    return sorted(out, key=lambda p: p["updated_at"], reverse=True)


def get(playlist_id: str) -> dict:
    with _lock:
        playlists = _read()
        playlist = _find(playlists, playlist_id)
        full, changed = _annotate(playlist, _Shelf())
        if changed:
            _write(playlists)
    return full


def _unique_name(playlists: list[dict], name: str) -> str:
    taken = {p["name"].casefold() for p in playlists}
    if name.casefold() not in taken:
        return name
    n = 2
    while f"{name} ({n})".casefold() in taken:
        n += 1
    return f"{name} ({n})"


def create(name: str, tracks: list[dict] | None = None, *, rename_if_taken: bool = False) -> dict:
    name = _clean_name(name)
    if not name:
        raise PlaylistError("A playlist needs a name")
    entries = _dedupe([e for e in (clean_entry(t) for t in tracks or []) if e])
    if len(entries) > MAX_TRACKS:
        raise PlaylistError(f"Too many songs in one playlist — {MAX_TRACKS} at most")
    with _lock:
        playlists = _read()
        if len(playlists) >= MAX_PLAYLISTS:
            raise PlaylistError(f"Too many playlists — {MAX_PLAYLISTS} at most")
        if rename_if_taken:
            name = _unique_name(playlists, name)
        now = time.time()
        playlist = {
            "id": _new_id(),
            "name": name,
            "created_at": now,
            "updated_at": now,
            "tracks": entries,
        }
        playlists.append(playlist)
        _write(playlists)
    return get(playlist["id"])


def _identity(entry: dict) -> tuple[str, str]:
    lead = entry["artists"][0] if entry["artists"] else ""
    return _bare_title(entry["title"]), _lead_artist(lead)


def _dedupe(entries: list[dict], existing: list[dict] = ()) -> list[dict]:
    seen = {_identity(e) for e in existing}
    files = {e["file"] for e in existing if e.get("file")}
    out = []
    for entry in entries:
        key = _identity(entry)
        if key in seen or (entry["file"] and entry["file"] in files):
            continue
        seen.add(key)
        if entry["file"]:
            files.add(entry["file"])
        out.append(entry)
    return out


def add_tracks(playlist_id: str, tracks: list[dict]) -> tuple[dict, int, int]:
    """Append songs, skipping ones the playlist already holds. Returns the
    playlist, how many were added, and how many were already there."""
    incoming = [e for e in (clean_entry(t) for t in tracks) if e]
    with _lock:
        playlists = _read()
        playlist = _find(playlists, playlist_id)
        fresh = _dedupe(incoming, playlist["tracks"])
        if len(playlist["tracks"]) + len(fresh) > MAX_TRACKS:
            raise PlaylistError(f"Too many songs in one playlist — {MAX_TRACKS} at most")
        if fresh:
            playlist["tracks"].extend(fresh)
            playlist["updated_at"] = time.time()
            _write(playlists)
    return get(playlist_id), len(fresh), len(incoming) - len(fresh)


def remove_track(playlist_id: str, uid: str) -> dict:
    with _lock:
        playlists = _read()
        playlist = _find(playlists, playlist_id)
        kept = [e for e in playlist["tracks"] if e["uid"] != uid]
        if len(kept) != len(playlist["tracks"]):
            playlist["tracks"] = kept
            playlist["updated_at"] = time.time()
            _write(playlists)
    return get(playlist_id)


def update(playlist_id: str, name: str | None = None, order: list[str] | None = None) -> dict:
    """Rename, reorder, or both. `order` is the full list of entry uids in
    their new order; uids it leaves out keep their place at the end, so a
    reorder racing an add can never drop a song."""
    with _lock:
        playlists = _read()
        playlist = _find(playlists, playlist_id)
        if name is not None:
            clean = _clean_name(name)
            if not clean:
                raise PlaylistError("A playlist needs a name")
            playlist["name"] = clean
        if order is not None:
            by_uid = {e["uid"]: e for e in playlist["tracks"]}
            ordered = [by_uid.pop(uid) for uid in order if uid in by_uid]
            playlist["tracks"] = ordered + [e for e in playlist["tracks"] if e["uid"] in by_uid]
        playlist["updated_at"] = time.time()
        _write(playlists)
    return get(playlist_id)


def delete(playlist_id: str) -> None:
    with _lock:
        playlists = _read()
        _find(playlists, playlist_id)
        _write([p for p in playlists if p["id"] != playlist_id])


def missing_tracks(playlist_id: str) -> tuple[str, list[Track]]:
    """The playlist's name and every song in it not yet on disk, as tracks
    the downloader can fetch. Entry uids double as track ids, so the job's
    per-track progress maps straight back onto playlist rows."""
    full = get(playlist_id)
    tracks = [
        Track(
            id=e["uid"],
            title=e["title"],
            artists=e["artists"] or [""],
            album=e.get("album") or "",
            duration_ms=e.get("duration_ms") or 0,
            cover_url=e.get("cover_url"),
            source_url=e.get("source_url"),
        )
        for e in full["tracks"]
        if not e["file_id"]
    ]
    return full["name"], tracks


# --------------------------------------------------------------------------
# Export and import


def _portable(entry: dict) -> dict:
    """What travels: the song, never this machine's ids."""
    return {
        "title": entry["title"],
        "artists": entry["artists"],
        "album": entry.get("album") or "",
        "duration_ms": entry.get("duration_ms") or 0,
        "cover_url": entry.get("cover_url"),
        "source_url": entry.get("source_url"),
        # Relative to the music folder: if that folder is copied across with
        # the playlist, the rows match without a single re-download.
        "file": entry.get("file") or None,
    }


def to_json(full: dict) -> str:
    return json.dumps(
        {
            "format": FORMAT,
            "version": FORMAT_VERSION,
            "name": full["name"],
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "tracks": [_portable(e) for e in full["tracks"]],
        },
        ensure_ascii=False,
        indent=2,
    )


def to_m3u(full: dict) -> str:
    """An extended M3U for every other player. Songs on disk point at their
    file, relative to the Playlists folder the export lands in; songs that
    are not fall back to the page they would stream from, which VLC and mpv
    can open directly. A song with neither has nothing to point at and is
    left out — the JSON export is the lossless one."""
    lines = ["#EXTM3U", f"#PLAYLIST:{full['name']}"]
    for entry in full["tracks"]:
        location = f"../{entry['file']}" if entry["file_id"] and entry.get("file") else None
        location = location or entry.get("source_url")
        if not location:
            continue
        seconds = round((entry.get("duration_ms") or 0) / 1000) or -1
        artist = ", ".join(entry["artists"])
        label = f"{artist} - {entry['title']}" if artist else entry["title"]
        lines.append(f"#EXTINF:{seconds},{label}")
        lines.append(location)
    return "\n".join(lines) + "\n"


def export(playlist_id: str, fmt: str = "json") -> Path:
    """Write the playlist into the music folder's Playlists/ and return the
    file. The folder is the app's own, so no path ever comes in from the
    request — the desktop shell reveals the file afterwards."""
    if fmt not in ("json", "m3u8"):
        raise PlaylistError("Export format must be json or m3u8")
    full = get(playlist_id)
    from .downloader import safe_filename

    folder = jobs.DOWNLOADS_DIR / EXPORT_FOLDER
    folder.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(full["name"]) or "playlist"
    if fmt == "json":
        path, body = folder / f"{stem}.unstream.json", to_json(full)
    else:
        path, body = folder / f"{stem}.m3u8", to_m3u(full)
    path.write_text(body, encoding="utf-8")
    return path


_EXTINF = re.compile(r"^#EXTINF:\s*(-?\d+(?:\.\d+)?)[^,]*,(.*)$")


def _parse_m3u(text: str, fallback: str) -> tuple[str, list[dict]]:
    name = fallback
    tracks: list[dict] = []
    pending: dict | None = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#PLAYLIST:"):
            name = line[len("#PLAYLIST:") :].strip() or name
            continue
        match = _EXTINF.match(line)
        if match:
            seconds = float(match.group(1))
            pending = {"label": match.group(2).strip(), "duration_ms": max(0, int(seconds * 1000))}
            continue
        if line.startswith("#"):
            continue
        label = (pending or {}).get("label") or re.sub(
            r"\.[A-Za-z0-9]{2,4}$", "", line.replace("\\", "/").rsplit("/", 1)[-1]
        )
        artist, _, title = label.partition(" - ")
        if not title:
            artist, title = "", label
        entry = {
            "title": title,
            "artists": [artist] if artist else [],
            "duration_ms": (pending or {}).get("duration_ms", 0),
        }
        if re.match(r"^https?://", line, re.IGNORECASE):
            entry["source_url"] = line
        tracks.append(entry)
        pending = None
    return name, tracks


def import_text(text: str, filename: str = "") -> dict:
    """Make a playlist from an export — ours, or any extended M3U."""
    if len(text.encode("utf-8", "ignore")) > MAX_IMPORT_BYTES:
        raise PlaylistError("That file is too large to be a playlist")
    stem = re.sub(r"(\.unstream)?\.(json|m3u8?)$", "", filename, flags=re.IGNORECASE)
    stripped = text.lstrip("﻿").strip()
    if stripped.startswith("{"):
        try:
            data = json.loads(stripped)
        except ValueError:
            raise PlaylistError("Not a playlist file Unstream can read") from None
        if not isinstance(data, dict) or data.get("format") != FORMAT:
            raise PlaylistError("Not a playlist file Unstream can read")
        if not isinstance(data.get("version"), int) or data["version"] > FORMAT_VERSION:
            raise PlaylistError("This playlist was exported by a newer Unstream — update first")
        name = _clean_name(data.get("name")) or stem
        tracks = data.get("tracks") if isinstance(data.get("tracks"), list) else []
    elif stripped.startswith("#EXTM3U") or filename.lower().endswith((".m3u", ".m3u8")):
        name, tracks = _parse_m3u(stripped, stem)
    else:
        raise PlaylistError("Not a playlist file Unstream can read")
    tracks = tracks[:MAX_TRACKS]
    if not any(clean_entry(t) for t in tracks):
        raise PlaylistError("That playlist has no songs in it")
    return create(name or "Playlist", tracks, rename_if_taken=True)
