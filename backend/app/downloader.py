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


# YouTube's answer to an address it doesn't trust. It arrives at the
# playability check, before a PO token is asked for and before a challenge
# exists to solve, so neither the provider nor the solver in app/ytdlp.py ever
# gets a turn — only a cookie gets past it.
_BOT_CHECK_RE = re.compile(
    r"Sign in to confirm you.{0,3}re not a bot|LOGIN_REQUIRED", re.IGNORECASE
)

_BOT_CHECK_MESSAGE = (
    "YouTube asked this server to sign in to confirm it is not a bot, so the "
    "audio could not be fetched. Datacenter and VPN addresses get this long "
    "before a home connection does. Point YTDLP_COOKIEFILE at a cookies.txt "
    "exported from a signed-in throwaway account to get past it."
)


class Cancelled(Exception):
    """The caller asked for this download to stop. Not a failure.

    Its own type rather than a DownloadError, because the retry loop below
    treats every failure as worth another attempt — and a cancellation is the
    one exception that must travel straight out.
    """


def _stop_if_cancelled(should_cancel: Callable[[], bool] | None) -> None:
    if should_cancel and should_cancel():
        raise Cancelled()


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


def _clean_partials(dest: Path, keep_part: bool = False) -> None:
    """Drop leftovers from a failed attempt so a retry starts clean.

    A stale .part or half-converted .webm makes yt-dlp resume a broken
    download, which is one way ffmpeg ends up with no mp3 to produce.
    When `keep_part` is true, `.part` files are preserved so yt-dlp can
    resume a partial download on retry (critical for large files / flaky
    connections). Only cancelled downloads should drop everything.
    """
    for path in _sibling_outputs(dest):
        if keep_part and path.suffix == ".part":
            continue
        # also keep .ytdl temp fragments when resuming
        if keep_part and path.suffix in (".ytdl", ".temp"):
            continue
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
    """Return the untouched stream, moved into a pure-audio container.

    Nothing is re-encoded — every case below is a copy-codec container swap.
    It exists because "original" promises the upload's own *audio*, and both
    of the containers that can smuggle a video track in (webm, mp4) either
    baffle mutagen or arrive as a music video instead of a song:

      * YouTube's audio-only streams are webm (Opus), which mutagen cannot
        tag, so they are remuxed into .opus (or .ogg for the Vorbis cases).
      * A video with no audio-only stream falls back to a combined mp4 whose
        audio track *is* the song — dropping the picture keeps the music and
        names the file honestly (.m4a) instead of shipping a video clip.

    A real m4a/opus/ogg/aac/flac stream is already pure audio and is returned
    untouched.
    """
    source = _downloaded_audio(dest)
    if source is None:
        raise DownloadError("no audio file was produced")
    suffix = source.suffix.lower()
    if suffix not in (".webm", ".mp4"):
        return source

    remux = ["-i", str(source), "-vn", "-codec:a", "copy"]
    if suffix == ".mp4":
        # The mp4 fallback's audio is AAC; .m4a is its honest, taggable name.
        out = _with_ext(dest, "m4a")
        _run_ffmpeg(remux, out, "remux")
    else:
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

    `should_cancel` is polled from the progress hook, which is the only thread
    of control the caller has while bytes are moving; a transfer is otherwise
    uninterruptible until the whole file is down.
    """

    def hook(status: dict) -> None:
        # yt-dlp's own signal for "stop, this was called off" — anything else
        # raised here is reported as a download failure and retried.
        if should_cancel and should_cancel():
            raise DownloadCancelled()
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

    try:
        with YoutubeDL(opts) as ydl:
            ydl.download([url])
    except DownloadCancelled as exc:
        raise Cancelled() from exc
    # A postprocessor runs after the last progress hook fires, so the encode
    # of a file nobody wants any more can only be caught here.
    _stop_if_cancelled(should_cancel)

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

    `should_cancel` makes the whole pipeline abandonable: it is polled between
    attempts and while bytes move, and raises `Cancelled` rather than a
    `DownloadError`, so the retry loop below cannot mistake being called off
    for a broken upload and go looking for another one. Partial files are
    cleaned up on the way out — a cancelled download leaves nothing behind.

    Attempt order: the track's own source page if it has one, then YouTube
    search (excluding failed uploads), then SoundCloud as the last resort.
    """
    if quality not in QUALITIES:
        raise DownloadError(f"Unsupported quality: {quality}")
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = safe_filename(filename or f"{', '.join(track.artists)} - {track.title}")
    dest = out_dir / stem

    if shutil.which("ffmpeg") is None:
        raise DownloadError("ffmpeg is not installed or not on PATH")

    failed_urls: set[str] = set()
    last_error: Exception | None = None
    bot_checked = False
    for attempt in range(attempts):
        if attempt:
            on_progress("retrying", 0.0)
            time.sleep(2 * attempt)
        url = None
        try:
            # Inside the try, so a cancellation between attempts leaves through
            # the same cleanup as one mid-transfer: the attempt that just failed
            # has partials of its own.
            _stop_if_cancelled(should_cancel)
            on_progress("searching", 0.0)
            if attempt == 0 and track.source_url:
                url = track.source_url
            elif attempt == attempts - 1:
                url = search_source(track, exclude=failed_urls, prefix="scsearch5")
            else:
                url = search_source(track, exclude=failed_urls, prefix="ytsearch8")

            if on_source:
                on_source(url, attempt + 1)
            # keep .part on retry so yt-dlp can resume; full clean only on first attempt or cancel
            _clean_partials(dest, keep_part=attempt > 0)
            on_progress("downloading", 0.0)
            audio = download_audio(
                url,
                dest,
                lambda frac: on_progress("downloading", frac),
                quality,
                should_cancel,
            )

            on_progress("tagging", 1.0)
            embed_tags(audio, track, _find_lyrics(track) if embed_lyrics else None)
            return audio
        except Cancelled:
            # Whatever came down is half a song nobody asked to keep, and the
            # stem is reused verbatim on a later download of the same track —
            # a leftover .part is what makes yt-dlp resume into a broken file.
            _clean_partials(dest)
            raise
        except Exception as exc:
            last_error = exc
            if _BOT_CHECK_RE.search(str(exc)):
                bot_checked = True
            if url:
                failed_urls.add(url)
    # The last attempt searches SoundCloud, so `last_error` is whatever that
    # unrelated upload happened to say — "This video is DRM protected", most
    # often. Reporting it verbatim hides the one cause an operator can act on.
    if bot_checked:
        raise DownloadError(_BOT_CHECK_MESSAGE) from last_error
    raise DownloadError(
        f"Failed after {attempts} attempts: {last_error}"
    ) from last_error
