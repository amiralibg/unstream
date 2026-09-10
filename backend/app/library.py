"""The on-disk music library: scan the downloads folder into playable tracks.

Jobs live in memory and die on restart; the files on disk are the durable
artifact, so the player reads the folder, not the job table. Every scan
rebuilds a hash → absolute-path index, and the file endpoint re-scans once
on a miss — added or renamed files show up with no restart. Everything
served is jailed inside DOWNLOADS_DIR: ids are content-free hashes, never
paths, and a resolved path outside the root is refused outright.

Tag reads are the expensive part — mutagen opens each file twice — so they
are memoised on (path, mtime, size). A rescan of an unchanged library then
costs one stat() per file instead of two file opens, which is what lets the
library view refetch freely while a download is writing into the same folder.
"""

import hashlib
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from . import jobs, lyrics

_EXTS = {".mp3", ".m4a", ".opus", ".ogg", ".wav", ".flac", ".mp4"}

# Cap the walk: a library is thousands of files, not millions, and an
# unbounded rglob on a folder the user repointed at / would hang the request.
# Generous by default because this runs against somebody's own music folder;
# the cache below is what keeps a library this size cheap to re-list.
MAX_FILES = max(1, int(os.getenv("UNSTREAM_LIBRARY_MAX_FILES", "20000")))

# Cover art is served to an <img>, so the mime type has to be right or the
# browser refuses it. Sniffed from the bytes rather than trusted from the
# tag, which is routinely "image/jpeg" on a PNG.
_MAGIC = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF8", "image/gif"),
    (b"RIFF", "image/webp"),
)


@dataclass
class LibraryTrack:
    id: str
    title: str
    artist: str
    album: str
    duration_ms: int
    size: int
    mtime: float
    has_lyrics: bool
    has_cover: bool

    def as_dict(self) -> dict:
        return asdict(self)


# Hash → absolute path, rebuilt by every scan.
_index: dict[str, Path] = {}

# Absolute path → (mtime, size, title, artist, album, duration_ms,
# has_lyrics, has_cover). Survives across scans; an entry whose file changed
# size or mtime is re-read, and one whose file is gone is dropped with it.
_tag_cache: dict[str, tuple] = {}


def _file_id(root: Path, path: Path) -> str:
    rel = path.resolve().relative_to(root.resolve()).as_posix()
    return hashlib.sha1(rel.encode("utf-8")).hexdigest()


def _raw_text(tags, *keys: str) -> str:
    """First non-empty text for any of `keys` across ID3 frames, MP4 atoms
    and Vorbis comments — three shapes of "a list of strings". Anything odd
    returns "" rather than raising; this runs on user files."""
    for key in keys:
        try:
            vals = tags.get(key)
        except Exception:
            continue
        if not vals:
            continue
        first = vals[0] if isinstance(vals, list) else vals
        text = getattr(first, "text", first)
        if isinstance(text, list):
            text = text[0] if text else ""
        if text:
            return str(text)
    return ""


def _lyric_frames(tags) -> list[str]:
    """Every embedded lyric string, whatever the container calls it.

    ID3 keys a USLT frame by language and descriptor (`USLT::eng`), so the
    prefix match is the only way to find it without guessing the suffix.
    """
    out: list[str] = []
    try:
        keys = list(tags.keys())
    except Exception:
        return out
    for key in keys:
        name = str(key)
        if not (
            name.startswith("USLT")
            or name in ("\xa9lyr", "LYRICS", "lyrics", "UNSYNCEDLYRICS", "unsyncedlyrics")
        ):
            continue
        text = _raw_text(tags, key)
        if text:
            out.append(text)
    return out


def _has_cover(raw) -> bool:
    """Whether the file carries embedded art, without decoding it."""
    try:
        if getattr(raw, "pictures", None):
            return True
        tags = getattr(raw, "tags", None)
        if tags is None:
            return False
        keys = set(str(k) for k in tags.keys())
        if any(k.startswith("APIC") for k in keys):
            return True
        if "covr" in keys:
            return bool(tags.get("covr"))
        return "metadata_block_picture" in keys
    except Exception:
        return False


def _read_tags(path: Path) -> tuple[str, str, str, int, bool, bool]:
    """Best-effort (title, artist, album, duration_ms, has_lyrics, has_cover).

    Anything unreadable falls back to the filename — "Artist - Title" splits,
    anything else is a title with no artist — because a library that hides
    files it can't parse is worse than one that shows them plainly.
    """
    title = artist = album = ""
    duration_ms = 0
    has_lyrics = has_cover = False
    try:
        from mutagen import File as MutagenFile

        # The easy interface covers the well-formed cases (mp3/m4a/opus
        # with proper headers); the raw pass below catches the rest, like
        # ID3 tags on a WAV, where easy refuses to look.
        easy = MutagenFile(path, easy=True)
        if easy is not None:

            def first(key: str) -> str:
                vals = easy.get(key) or []
                return str(vals[0]) if vals else ""

            title, artist, album = first("title"), first("artist"), first("album")
            try:
                duration_ms = int((easy.info.length or 0) * 1000)
            except Exception:
                pass
        raw = MutagenFile(path)
        if raw is not None:
            has_cover = _has_cover(raw)
            tags = getattr(raw, "tags", None)
            if tags is not None:
                title = title or _raw_text(tags, "TIT2", "\xa9nam")
                artist = artist or _raw_text(tags, "TPE1", "\xa9ART")
                album = album or _raw_text(tags, "TALB", "\xa9alb")
                has_lyrics = bool(_lyric_frames(tags))
    except Exception:
        pass
    # A sidecar .lrc counts as lyrics even when the container carries none —
    # it is what the karaoke view actually wants, and wav/aac can't hold a
    # USLT frame at all.
    if not has_lyrics and _sidecar(path) is not None:
        has_lyrics = True
    if not title:
        stem = path.stem
        if " - " in stem:
            left, right = stem.split(" - ", 1)
            artist, title = left.strip(), right.strip()
        else:
            title = stem
    return title or "Unknown", artist, album, duration_ms, has_lyrics, has_cover


def _cached_tags(path: Path, mtime: float, size: int) -> tuple[str, str, str, int, bool, bool]:
    """`_read_tags`, skipped when the file has not changed since last scan."""
    key = str(path)
    hit = _tag_cache.get(key)
    if hit is not None and hit[0] == mtime and hit[1] == size:
        return hit[2:]
    fresh = _read_tags(path)
    _tag_cache[key] = (mtime, size, *fresh)
    return fresh


def scan(root: Path | None = None) -> list[LibraryTrack]:
    """Walk the downloads folder; newest files first, like a shelf of arrivals."""
    base = root or jobs.DOWNLOADS_DIR
    tracks: list[LibraryTrack] = []
    _index.clear()
    if not base.exists():
        _tag_cache.clear()
        return tracks
    try:
        # One stat() per file, kept — sorting by mtime needs it and so does
        # the cache check, and os.scandir hands it over without a second
        # syscall on every platform that matters.
        found: list[tuple[Path, os.stat_result]] = []
        for entry in _walk(base):
            try:
                found.append((Path(entry.path), entry.stat()))
            except OSError:
                continue
        found.sort(key=lambda pair: pair[1].st_mtime, reverse=True)
        files = found[:MAX_FILES]
    except OSError:
        return tracks
    seen: set[str] = set()
    for path, stat in files:
        try:
            title, artist, album, duration_ms, has_lyrics, has_cover = _cached_tags(
                path, stat.st_mtime, stat.st_size
            )
            # A symlink pointing outside the root raises here — skipped, not
            # served, which is exactly what the jail is for.
            file_id = _file_id(base, path)
        except (OSError, ValueError):
            continue
        # `seen` holds cache keys, so it must use the same unresolved string
        # `_cached_tags` keyed on — not the resolved path the index stores.
        seen.add(str(path))
        _index[file_id] = path.resolve()
        tracks.append(
            LibraryTrack(
                id=file_id,
                title=title,
                artist=artist,
                album=album,
                duration_ms=duration_ms,
                size=stat.st_size,
                mtime=stat.st_mtime,
                has_lyrics=has_lyrics,
                has_cover=has_cover,
            )
        )
    # Drop cache entries for files that are gone, so a long-running app that
    # downloads and deletes for weeks doesn't grow a dictionary forever.
    if len(_tag_cache) > len(seen):
        for key in [k for k in _tag_cache if k not in seen]:
            _tag_cache.pop(key, None)
    return tracks


def _walk(base: Path):
    """Audio files under `base`, depth-first, skipping what we can't read."""
    stack = [base]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                        elif entry.is_file() and Path(entry.name).suffix.lower() in _EXTS:
                            yield entry
                    except OSError:
                        continue
        except OSError:
            continue


def resolve(file_id: str, root: Path | None = None) -> Path | None:
    """Absolute path for an id, or None. Re-scans once so a file added since
    the last listing still plays; refuses anything outside the root."""
    base = (root or jobs.DOWNLOADS_DIR).resolve()
    path = _index.get(file_id)
    if path is None:
        scan(root)
        path = _index.get(file_id)
    if path is None or not path.is_file():
        return None
    try:
        path.relative_to(base)
    except ValueError:
        return None
    return path


def _sniff(data: bytes) -> str:
    for magic, mime in _MAGIC:
        if data.startswith(magic):
            return mime
    return "application/octet-stream"


def cover(file_id: str, root: Path | None = None) -> tuple[bytes, str] | None:
    """Embedded art for one track as (bytes, mime), or None.

    Decoded on demand rather than cached in memory: art is a few hundred KB
    per track, the endpoint hands the browser an ETag, and a cached <img>
    never asks twice.
    """
    path = resolve(file_id, root)
    if path is None:
        return None
    try:
        from mutagen import File as MutagenFile

        raw = MutagenFile(path)
        if raw is None:
            return None
        pictures = getattr(raw, "pictures", None)
        if pictures:
            data = bytes(pictures[0].data)
            return (data, _sniff(data)) if data else None
        tags = getattr(raw, "tags", None)
        if tags is None:
            return None
        for key in list(tags.keys()):
            if str(key).startswith("APIC"):
                frame = tags.get(key)
                frame = frame[0] if isinstance(frame, list) else frame
                data = bytes(getattr(frame, "data", b"") or b"")
                if data:
                    return data, _sniff(data)
        covr = tags.get("covr") if "covr" in tags else None
        if covr:
            data = bytes(covr[0])
            return (data, _sniff(data)) if data else None
        block = tags.get("metadata_block_picture") if "metadata_block_picture" in tags else None
        if block:
            import base64

            from mutagen.flac import Picture

            data = bytes(Picture(base64.b64decode(block[0])).data)
            return (data, _sniff(data)) if data else None
    except Exception:
        return None
    return None


# A line that opens with [mm:ss] — the difference between a karaoke roll and
# a wall of text.
_LRC_RE = re.compile(r"^\s*\[\d+:\d+(?:[.:]\d+)?\]")


def _sidecar(path: Path) -> Path | None:
    """The `.lrc` next to a track, if one is there.

    Sidecars are how every desktop player stores synced lyrics, and they are
    the only option for containers with no lyric frame at all.
    """
    lrc = path.with_suffix(".lrc")
    try:
        return lrc if lrc.is_file() else None
    except OSError:
        return None


def lyrics_for(file_id: str, root: Path | None = None) -> dict | None:
    """Offline lyrics for one library track: `{plain, synced, source}`.

    Reads what is already on the machine — the sidecar `.lrc` first, since
    only that carries timings, then the embedded frame. Returns None when
    the track has neither, which is the caller's cue to go to the network.
    """
    path = resolve(file_id, root)
    if path is None:
        return None
    synced = plain = ""
    lrc = _sidecar(path)
    if lrc is not None:
        try:
            text = lrc.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            text = ""
        if text:
            if any(_LRC_RE.match(line) for line in text.splitlines()):
                synced = text
            else:
                plain = text
    if not plain:
        try:
            from mutagen import File as MutagenFile

            raw = MutagenFile(path)
            tags = getattr(raw, "tags", None) if raw is not None else None
            frames = _lyric_frames(tags) if tags is not None else []
        except Exception:
            frames = []
        for text in frames:
            text = text.strip()
            if not text:
                continue
            # An embedded frame is usually plain, but a player that wrote LRC
            # into it is common enough to be worth checking.
            if not synced and any(_LRC_RE.match(line) for line in text.splitlines()):
                synced = text
            elif not plain:
                plain = text
    if not synced and not plain:
        return None
    if synced and not plain:
        # A synced-only sidecar is the common case — LRCLIB hands back LRC and
        # `_write_lrc` stores it verbatim. Answering with an empty `plain`
        # would make this endpoint's own contract read as "timings but no
        # words" to any caller that only knows how to render the plain text.
        plain = lyrics.strip_lrc(synced)
    return {"plain": plain, "synced": synced, "source": "file"}
