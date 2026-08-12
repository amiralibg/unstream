"""Find a track's audio, download it, encode it and tag it.

Pipeline per track:
  1. If the track already points at a YouTube/SoundCloud page (source_url),
     download that directly. Otherwise yt-dlp `ytsearch8:` for
     "<artists> - <title>" and pick the result whose duration is closest to
     the catalog duration (rejects live versions, hour-long mixes, etc.).
  2. Download bestaudio. For an mp3 quality, yt-dlp's ffmpeg postprocessor
     encodes at the requested bitrate (and if it leaves a non-mp3 audio
     file behind, we convert it ourselves rather than failing). For
     "original", the upload's own stream is kept as-is — no re-encode.
  3. Embed tags + album art from the catalog metadata with mutagen, in
     whatever tag format the resulting container speaks.

Retries exclude the exact video that just failed, and the final attempt
searches SoundCloud instead of YouTube, so one broken upload never sinks
the track.
"""

import base64
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable
from urllib.request import urlopen

from mutagen import File as MutagenFile
from mutagen.flac import Picture
from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRCK, USLT
from mutagen.mp4 import MP4, MP4Cover
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadCancelled

from . import analytics, lyrics
from .models import Track
from .ytdlp import base_opts

# A candidate must be within this many seconds of the catalog duration.
MAX_DURATION_DRIFT = 20

# What the user can ask for. The mp3 values are lame bitrates in kbps; the
# source upload is already lossy, so 320 adds no detail — it just stops the
# re-encode from throwing more away. "original" skips the encode entirely
# and keeps the upload's own m4a/opus stream: the best fidelity available,
# at the cost of a format not every device plays.
BITRATES = ("128", "192", "320")
ORIGINAL = "original"
QUALITIES = (*BITRATES, ORIGINAL)
DEFAULT_QUALITY = "192"

# Extensions the manual ffmpeg fallback will happily convert.
_AUDIO_EXTS = {".webm", ".m4a", ".opus", ".ogg", ".aac", ".wav", ".flac", ".mp4"}


class DownloadError(Exception):
    pass


class Cancelled(Exception):
    """The caller asked for this download to stop.

    Deliberately *not* a DownloadError: the retry loop treats every other
    failure as something worth another attempt, and a cancellation is the
    one thing that must never be retried.
    """


def safe_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip().rstrip(".") or "track"


def _with_ext(dest: Path, ext: str) -> Path:
    """`dest` + ".ext". Not `with_suffix`: that treats a dot inside the
    title as an extension ("Still D.R.E" would become "Still D.mp3")."""
    return dest.with_name(f"{dest.name}.{ext}")


def _sibling_outputs(dest: Path) -> list[Path]:
    """Every file yt-dlp may have produced for this stem (dest.<ext>)."""
    if not dest.parent.exists():
        return []
    prefix = dest.name + "."
    return [p for p in dest.parent.iterdir() if p.name.startswith(prefix)]


def _clean_partials(dest: Path) -> None:
    """Drop leftovers from a failed attempt so a retry starts clean.

    A stale .part or half-converted .webm makes yt-dlp resume a broken
    download, which is one way ffmpeg ends up with no mp3 to produce.
    """
    for path in _sibling_outputs(dest):
        path.unlink(missing_ok=True)


def _pick_candidate(entries: list[dict], target_seconds: float) -> dict:
    """Pick the search result whose duration best matches the catalog's."""
    if target_seconds <= 0:
        if entries:
            return entries[0]
        raise DownloadError("No results found")
    scored = []
    for entry in entries:
        duration = entry.get("duration")
        if not duration:
            continue
        drift = abs(duration - target_seconds)
        if drift <= MAX_DURATION_DRIFT:
            scored.append((drift, entry))
    if scored:
        return min(scored, key=lambda pair: pair[0])[1]
    if entries:
        # Nothing within tolerance — fall back to the top result.
        return entries[0]
    raise DownloadError("No results found")


def search_source(
    track: Track, exclude: set[str] = frozenset(), prefix: str = "ytsearch8"
) -> str:
    """Return the URL of the best-matching upload on YouTube or SoundCloud.

    `exclude` holds URLs that already failed for this track (e.g. a 403);
    a retry then picks the next-best candidate instead of hitting the same
    broken upload again. `prefix` selects the site: ytsearchN / scsearchN.
    """
    opts = base_opts(
        extract_flat=True,  # metadata only, don't resolve each video
        noplaylist=True,
        retries=3,
        socket_timeout=15,
    )
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"{prefix}:{track.query}", download=False)
    entries = [e for e in (info.get("entries") or []) if e]
    usable = [e for e in entries if e.get("url") not in exclude] or entries
    chosen = _pick_candidate(usable, track.duration_ms / 1000)
    return chosen["url"]


def _run_ffmpeg(args: list[str], produced: Path, what: str) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-y", *args, str(produced)], capture_output=True, timeout=300
    )
    if proc.returncode != 0 or not produced.exists():
        produced.unlink(missing_ok=True)  # ffmpeg may leave an empty shell
        tail = proc.stderr.decode(errors="replace").strip().splitlines()[-1:]
        raise DownloadError(f"ffmpeg {what} failed: {' '.join(tail)}")


def _ffmpeg_convert(source: Path, mp3: Path, bitrate: str = DEFAULT_QUALITY) -> None:
    _run_ffmpeg(
        ["-i", str(source), "-vn", "-codec:a", "libmp3lame", "-b:a", f"{bitrate}k"],
        mp3,
        "conversion",
    )


def _downloaded_audio(dest: Path) -> Path | None:
    """The largest raw audio file yt-dlp left behind for this stem."""
    files = [p for p in _sibling_outputs(dest) if p.suffix.lower() in _AUDIO_EXTS]
    return max(files, key=lambda p: p.stat().st_size) if files else None


def _keep_original(dest: Path) -> Path:
    """Return the untouched stream, moving webm audio into an Ogg container.

    Nothing is re-encoded — the webm case is a copy-codec container swap,
    done only because mutagen (and plenty of players) cannot handle audio
    in webm, so the file would otherwise arrive untagged.
    """
    source = _downloaded_audio(dest)
    if source is None:
        raise DownloadError("no audio file was produced")
    if source.suffix.lower() != ".webm":
        return source

    remux = ["-i", str(source), "-vn", "-codec:a", "copy"]
    try:
        # YouTube's webm audio is Opus in practice; .opus is the honest name.
        out = _with_ext(dest, "opus")
        _run_ffmpeg(remux, out, "remux")
    except DownloadError:
        # Vorbis (or anything else the Opus muxer rejects) still fits in Ogg.
        out = _with_ext(dest, "ogg")
        _run_ffmpeg(remux, out, "remux")
    source.unlink(missing_ok=True)
    return out


def download_audio(
    url: str,
    dest: Path,
    on_progress: Callable[[float], None] | None = None,
    quality: str = DEFAULT_QUALITY,
    should_cancel: Callable[[], bool] | None = None,
) -> Path:
    """Download `url` into `dest` (a path without extension) at `quality`.

    Returns the audio file actually produced — an mp3 for a bitrate, or the
    upload's own m4a/opus for "original".

    `should_cancel` is polled from the progress hook, which is what makes a
    long download abortable at all: yt-dlp runs it on this thread, so the
    only way in is a callback it already calls, and the only way out is an
    exception raised from inside one.
    """

    def hook(status: dict) -> None:
        if should_cancel and should_cancel():
            # yt-dlp's own signal for this: it unwinds the download without
            # being mistaken for a network failure and retried.
            raise DownloadCancelled("cancelled by the user")
        if on_progress and status.get("status") == "downloading":
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            if total:
                on_progress(status.get("downloaded_bytes", 0) / total)

    opts = base_opts(
        format="bestaudio/best",
        outtmpl=str(dest) + ".%(ext)s",
        noplaylist=True,
        retries=5,
        fragment_retries=5,
        socket_timeout=15,
        nopart=False,
        overwrites=True,
        progress_hooks=[hook],
    )
    if quality != ORIGINAL:
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": quality,
            }
        ]

    with YoutubeDL(opts) as ydl:
        try:
            ydl.download([url])
        except DownloadCancelled as exc:
            raise Cancelled(str(exc)) from exc

    # The ffmpeg postprocessor runs after the last progress hook, so this is
    # the first chance to notice a cancellation that landed during the encode.
    if should_cancel and should_cancel():
        raise Cancelled("cancelled by the user")

    if quality == ORIGINAL:
        return _keep_original(dest)

    mp3 = _with_ext(dest, "mp3")
    if mp3.exists():
        return mp3

    # The postprocessor sometimes leaves the raw audio behind (odd container,
    # interrupted convert). Salvage it with a direct ffmpeg pass instead of
    # declaring the track failed.
    source = _downloaded_audio(dest)
    if source:
        _ffmpeg_convert(source, mp3, quality)
        source.unlink(missing_ok=True)
        return mp3
    raise DownloadError("no audio file was produced")


def _cover_bytes(track: Track) -> bytes | None:
    if not track.cover_url:
        return None
    try:
        with urlopen(track.cover_url, timeout=10) as resp:
            return resp.read()
    except OSError:
        return None  # cover art is nice-to-have


def _tag_mp3(path: Path, track: Track, cover: bytes | None, lyrics_text: str | None) -> None:
    tags = ID3()
    tags.add(TIT2(encoding=3, text=track.title))
    tags.add(TPE1(encoding=3, text=", ".join(track.artists)))
    tags.add(TPE2(encoding=3, text=track.artists[0] if track.artists else ""))
    tags.add(TALB(encoding=3, text=track.album))
    if track.track_number:
        tags.add(TRCK(encoding=3, text=str(track.track_number)))
    if track.release_date:
        tags.add(TDRC(encoding=3, text=track.release_date[:4]))
    if lyrics_text:
        # `lang` is ISO 639-2: 'fas' for Arabic-script text (Persian, Arabic),
        # 'eng' otherwise — players use it to pick an LRC file per language.
        tags.add(
            USLT(
                encoding=3,
                lang=lyrics.detect_lang(lyrics_text),
                desc="",
                text=lyrics_text,
            )
        )
    if cover:
        tags.add(
            APIC(
                encoding=3,
                mime="image/jpeg",
                type=3,  # front cover
                desc="Cover",
                data=cover,
            )
        )
    tags.save(path)


def _tag_mp4(path: Path, track: Track, cover: bytes | None, lyrics_text: str | None) -> None:
    """iTunes-style atoms, for the m4a an "original" download usually is."""
    audio = MP4(path)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    tags["\xa9nam"] = [track.title]
    tags["\xa9ART"] = [", ".join(track.artists)]
    tags["aART"] = [track.artists[0] if track.artists else ""]
    tags["\xa9alb"] = [track.album]
    if track.track_number:
        tags["trkn"] = [(track.track_number, 0)]
    if track.release_date:
        tags["\xa9day"] = [track.release_date[:4]]
    if lyrics_text:
        tags["\xa9lyr"] = [lyrics_text]
    if cover:
        tags["covr"] = [MP4Cover(cover, imageformat=MP4Cover.FORMAT_JPEG)]
    audio.save()


def _tag_ogg(path: Path, track: Track, cover: bytes | None, lyrics_text: str | None) -> None:
    """Vorbis comments — mutagen picks Opus vs Vorbis from the file itself."""
    audio = MutagenFile(path)
    if audio is None:
        return
    audio["title"] = [track.title]
    audio["artist"] = [", ".join(track.artists)]
    audio["albumartist"] = [track.artists[0] if track.artists else ""]
    audio["album"] = [track.album]
    if track.track_number:
        audio["tracknumber"] = [str(track.track_number)]
    if track.release_date:
        audio["date"] = [track.release_date[:4]]
    if lyrics_text:
        audio["lyrics"] = [lyrics_text]
    if cover:
        picture = Picture()
        picture.data = cover
        picture.type = 3  # front cover
        picture.mime = "image/jpeg"
        # Ogg carries art as a base64 FLAC picture block in a comment.
        audio["metadata_block_picture"] = [
            base64.b64encode(picture.write()).decode("ascii")
        ]
    audio.save()


_TAGGERS = {
    ".mp3": _tag_mp3,
    ".m4a": _tag_mp4,
    ".mp4": _tag_mp4,
    ".opus": _tag_ogg,
    ".ogg": _tag_ogg,
    ".oga": _tag_ogg,
}


def embed_tags(path: Path, track: Track, lyrics_text: str | None = None) -> None:
    """Write catalog metadata + art (+ lyrics) in whatever format the file speaks.

    A container with no tag support (raw aac, wav) is left alone — the
    audio is still perfectly good, it just arrives unlabelled.
    """
    tagger = _TAGGERS.get(path.suffix.lower())
    if tagger:
        tagger(path, track, _cover_bytes(track), lyrics_text)


def _find_lyrics(track: Track) -> str | None:
    """Best-effort lyrics for embedding. Never raises, never blocks a download.

    Same contract as cover art: nice to have, silent when it fails.

    The outcome is counted here and not only at the API, because embedding is
    where most lookups happen: an album asks once per track, while the sheet is
    opened one song at a time. Anything that is not a clear found-or-absent
    counts as "unavailable" — including a bug in here, which is the honest
    reading, since what it means is that we did not get an answer.
    """
    artist = ", ".join(track.artists)
    outcome, plain = "unavailable", None
    try:
        found = lyrics.fetch(artist, track.title, track.album, track.duration_ms / 1000)
        outcome = "found" if found else "absent"
        plain = found.plain if found else None
    except Exception:
        pass  # a lyric is never worth failing a download over
    # `record` swallows its own errors, so counting cannot cost a download.
    analytics.record("lyrics_embed", detail=outcome, label=f"{artist} - {track.title}")
    return plain


def download_track(
    track: Track,
    out_dir: Path,
    on_progress: Callable[[str, float], None],
    attempts: int = 4,
    filename: str | None = None,
    quality: str = DEFAULT_QUALITY,
    on_source: Callable[[str, int], None] | None = None,
    embed_lyrics: bool = True,
    should_cancel: Callable[[], bool] | None = None,
) -> Path:
    """Full pipeline for one track. Reports (stage, fraction) via callback.

    `filename` (no extension) lets the caller guarantee a unique name —
    two tracks sharing one stem would otherwise clobber each other's files
    mid-download when they run concurrently. `quality` is an mp3 bitrate in
    kbps or "original"; see QUALITIES.

    `on_source` is told which upload each attempt settled on, and which
    attempt it was — the only place that knows whether a track came from
    its own page, from YouTube search, or from the SoundCloud last resort.

    `embed_lyrics` toggles the best-effort lyric lookup that runs during
    tagging; its failure is swallowed by `_find_lyrics`, so lyrics can never
    make a track fail that would otherwise download fine.

    `should_cancel`, if given, is checked between stages and from inside the
    download itself; once it answers True this raises `Cancelled` and leaves
    no half-written file behind.

    Attempt order: the track's own source page if it has one, then YouTube
    search (excluding failed uploads), then SoundCloud as the last resort.
    """
    if quality not in QUALITIES:
        raise DownloadError(f"Unsupported quality: {quality}")

    def stop_requested() -> bool:
        return bool(should_cancel and should_cancel())

    # Before anything with a side effect or an opinion. A track pulled off a
    # cancelled job's queue has nothing to say about the environment it was
    # never going to run in — checking ffmpeg first reported a stopped
    # download as a broken install.
    if stop_requested():
        raise Cancelled("cancelled by the user")

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(filename or f"{', '.join(track.artists)} - {track.title}")
    dest = out_dir / stem

    if shutil.which("ffmpeg") is None:
        raise DownloadError("ffmpeg is not installed or not on PATH")

    failed_urls: set[str] = set()
    last_error: Exception | None = None
    for attempt in range(attempts):
        if stop_requested():
            raise Cancelled("cancelled by the user")
        if attempt:
            on_progress("retrying", 0.0)
            time.sleep(2 * attempt)
        url = None
        try:
            on_progress("searching", 0.0)
            if attempt == 0 and track.source_url:
                url = track.source_url
            elif attempt == attempts - 1:
                url = search_source(track, exclude=failed_urls, prefix="scsearch5")
            else:
                url = search_source(track, exclude=failed_urls, prefix="ytsearch8")

            if on_source:
                on_source(url, attempt + 1)
            _clean_partials(dest)
            on_progress("downloading", 0.0)
            audio = download_audio(
                url,
                dest,
                lambda frac: on_progress("downloading", frac),
                quality,
                should_cancel,
            )

            if stop_requested():
                raise Cancelled("cancelled by the user")
            on_progress("tagging", 1.0)
            embed_tags(audio, track, _find_lyrics(track) if embed_lyrics else None)
            return audio
        except Cancelled:
            # Not another attempt's problem, and the partial file is nobody's:
            # the queue entry is going away, so nothing will ever finish it.
            _clean_partials(dest)
            raise
        except Exception as exc:
            last_error = exc
            if url:
                failed_urls.add(url)
    raise DownloadError(
        f"Failed after {attempts} attempts: {last_error}"
    ) from last_error
