"""In-memory download jobs.

A job is one batch of tracks (a playlist, an album, or a single song).
Tracks download concurrently on a small thread pool; the frontend polls
GET /api/jobs/{id} for per-track progress.

A background sweeper keeps the downloads folder from growing forever:
job directories older than DOWNLOADS_TTL_HOURS (default 24) are deleted
once their job has finished, and orphan directories from previous runs
are cleaned the same way. Whatever outlives that pass is then held under
MAX_DOWNLOADS_GB by evicting the oldest jobs first.

Either limit can be switched off with 0, and a self-hosted instance
downloading into a folder someone actually browses usually switches both
off — the sweeper exists because a public server's disk is shared with
strangers, which is not true of a laptop or a NAS.
"""

import os
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import analytics, downloader
from .models import Track

DOWNLOADS_DIR = Path(__file__).resolve().parent.parent / "downloads"

# 0 keeps finished downloads forever. The default suits a server whose disk
# is shared with strangers; it is the wrong default for someone downloading
# to their own machine, which is why it is the first thing self-hosters set.
DOWNLOADS_TTL_HOURS = float(os.getenv("DOWNLOADS_TTL_HOURS", "24"))

# The TTL alone is not a disk limit. Three workers can land on the order of
# 500 tracks an hour, and nothing is deleted for a day — enough to fill a
# small VPS long before the first job expires. This is the actual ceiling:
# over it, the sweeper evicts finished jobs oldest-first until it is back
# under, so the volume trades history for staying writable. 0 disables it,
# on the same reasoning as the TTL above.
DOWNLOADS_MAX_BYTES = int(float(os.getenv("MAX_DOWNLOADS_GB", "20")) * 1024**3)

# Ten minutes, not an hour: a budget checked hourly can be exceeded for an
# hour. The sweep is a stat() per file, so running it often is cheap.
_SWEEP_INTERVAL_SECONDS = 600

# Be polite to YouTube: a few tracks at a time, not the whole playlist.
#
# Raising this is the obvious way to make a long discography finish sooner,
# and it is also the fastest way to get bot-checked — the limit being bought
# is how many requests one address makes at once, which is the signal being
# watched. A home connection has more room here than a datacenter one, but
# it is still the thing that breaks first, so move it in small steps.
DOWNLOAD_WORKERS = max(1, int(os.getenv("DOWNLOAD_WORKERS", "3")))
_executor = ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS)

# Track states nothing more will ever happen to. A cancelled track counts as
# settled the same way an errored one does — the job is over either way, and
# without that a stopped job would never look finished and would be polled,
# and held out of the sweeper's reach, forever.
_SETTLED = ("done", "error", "cancelled")


@dataclass
class TrackState:
    track: Track
    filename: str  # unique stem within the job, no extension
    # queued | searching | downloading | tagging | retrying | done | error | cancelled
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    file_path: Path | None = None

    def as_dict(self) -> dict:
        return {
            "id": self.track.id,
            "status": self.status,
            "progress": round(self.progress, 3),
            "error": self.error,
            # "mp3" / "m4a" / "opus" — the UI labels its save link with it.
            "ext": self.file_path.suffix.lstrip(".") if self.file_path else None,
        }


@dataclass
class Job:
    id: str
    name: str
    quality: str = downloader.DEFAULT_QUALITY
    # Whether finished files get lyrics embedded in their tags. The UI sets
    # this per job from a global preference, the same way it picks quality.
    embed_lyrics: bool = True
    # Opaque client key (an IP, from app.limits), only for counting a caller's
    # jobs in flight. Never leaves the process — as_dict() omits it, and job
    # ids stay unguessable so anyone holding one can still fetch it.
    owner: str = ""
    # Analytics only: a hashed, daily-rotating pseudonym, so a finished track
    # can be attributed without the download pipeline ever seeing an address.
    visitor: str = ""
    tracks: dict[str, TrackState] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)
    # Set once, never cleared: a job the user stopped does not resume. Workers
    # poll it rather than being killed — a thread pool has no way to interrupt
    # a running task, so the task has to agree to stop.
    stop: threading.Event = field(default_factory=threading.Event)

    @property
    def dir(self) -> Path:
        return DOWNLOADS_DIR / self.id

    @property
    def finished(self) -> bool:
        with self.lock:
            return all(s.status in _SETTLED for s in self.tracks.values())

    def as_dict(self) -> dict:
        with self.lock:
            states = [s.as_dict() for s in self.tracks.values()]
        done = sum(1 for s in states if s["status"] == "done")
        failed = sum(1 for s in states if s["status"] == "error")
        settled = sum(1 for s in states if s["status"] in _SETTLED)
        return {
            "id": self.id,
            "name": self.name,
            "quality": self.quality,
            "tracks": states,
            "done": done,
            "failed": failed,
            "total": len(states),
            "finished": settled == len(states),
            # Whether it stopped early because someone asked it to, which is
            # the difference between "3 of 20" as a result and as a failure.
            "cancelled": self.stop.is_set(),
        }


_jobs: dict[str, Job] = {}


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def live_counts() -> dict:
    """What the process is doing right now — for the admin dashboard."""
    snapshot = list(_jobs.values())
    running = [job for job in snapshot if not job.finished]
    return {
        "active_jobs": len(running),
        "active_tracks": sum(
            1
            for job in running
            for state in list(job.tracks.values())
            if state.status not in ("done", "error")
        ),
        "jobs_tracked": len(snapshot),
    }


def active_count(owner: str) -> int:
    """How many of this client's jobs are still running."""
    # list() so a concurrent start() resizing the dict can't break iteration.
    return sum(1 for job in list(_jobs.values()) if job.owner == owner and not job.finished)


_AUDIO_HOSTS = (
    ("youtu", "youtube"),
    ("soundcloud", "soundcloud"),
)


def _host_of(url: str) -> str:
    for needle, name in _AUDIO_HOSTS:
        if needle in url:
            return name
    return "other"


def _run_track(job: Job, state: TrackState) -> None:
    # Cancelling a 100-track job leaves most of it sitting in the pool queue;
    # those tasks still run, and this is where they cost nothing.
    if job.stop.is_set():
        with job.lock:
            state.status = "cancelled"
        return

    def on_progress(stage: str, fraction: float) -> None:
        # Once stopped, cancel() has already written the final status and a
        # late stage report from the unwinding download would undo it.
        if job.stop.is_set():
            return
        with job.lock:
            state.status = stage
            state.progress = fraction

    # Which upload the download settled on, and on which try — the pipeline
    # can fall back through YouTube search to SoundCloud, so neither is
    # knowable from the outside until it happens.
    chosen = {"url": "", "attempt": 0}

    def on_source(url: str, attempt: int) -> None:
        chosen.update(url=url, attempt=attempt)

    label = f"{', '.join(state.track.artists)} - {state.track.title}"
    started = time.monotonic()
    try:
        path = downloader.download_track(
            state.track,
            job.dir,
            on_progress,
            filename=state.filename,
            quality=job.quality,
            on_source=on_source,
            embed_lyrics=job.embed_lyrics,
            should_cancel=job.stop.is_set,
        )
        with job.lock:
            state.status = "done"
            state.progress = 1.0
            state.file_path = path
        analytics.record(
            "track_done",
            visitor=job.visitor or None,
            source=_host_of(chosen["url"]),
            detail=job.quality,
            label=label,
            value=chosen["attempt"],
            ms=int((time.monotonic() - started) * 1000),
        )
    except downloader.Cancelled:
        # Not a failure and not worth an analytics row — the user asked for it,
        # and cancel() has already counted the job once.
        with job.lock:
            state.status = "cancelled"
    except Exception as exc:  # any failure marks just this track, not the job
        with job.lock:
            state.status = "error"
            state.error = str(exc)
        analytics.record(
            "track_error",
            visitor=job.visitor or None,
            source=_host_of(chosen["url"]),
            detail=analytics.error_class(str(exc)),
            label=label,
            value=chosen["attempt"],
            ms=int((time.monotonic() - started) * 1000),
        )


def start(
    name: str,
    tracks: list[Track],
    quality: str = downloader.DEFAULT_QUALITY,
    embed_lyrics: bool = True,
    owner: str = "",
    visitor: str = "",
) -> Job:
    job = Job(
        id=uuid.uuid4().hex[:12],
        name=name,
        quality=quality,
        embed_lyrics=embed_lyrics,
        owner=owner,
        visitor=visitor,
    )
    # Two different tracks can share "Artist - Title" (playlist duplicates,
    # remastered copies). Concurrent downloads to one filename truncate each
    # other mid-conversion, so make every stem unique up front.
    used: set[str] = set()
    for track in tracks:
        base = downloader.safe_filename(
            f"{', '.join(track.artists)} - {track.title}"
        )
        stem, n = base, 2
        while stem.lower() in used:
            stem = f"{base} ({n})"
            n += 1
        used.add(stem.lower())
        job.tracks[track.id] = TrackState(track=track, filename=stem)
    _jobs[job.id] = job
    for state in job.tracks.values():
        _executor.submit(_run_track, job, state)
    return job


def cancel(job: Job) -> int:
    """Stop a job and report how many tracks that actually cut short.

    Returns immediately: the flag is what workers act on, and the one running
    the download notices at its next progress callback — a second or so, not
    the rest of the track. Statuses are written here rather than by the
    workers so the next poll already reflects the cancellation, whether the
    track was mid-download or still queued behind two others.

    Whatever finished before this point is left alone, files included: the
    tracks that are already on disk are still the ones the user asked for,
    and can still be saved from the panel.
    """
    job.stop.set()
    with job.lock:
        stopped = [s for s in job.tracks.values() if s.status not in _SETTLED]
        for state in stopped:
            state.status = "cancelled"
    return len(stopped)


def shutdown() -> None:
    """Stop everything in flight so the process can actually exit.

    Without this, Ctrl+C hangs. The pool's threads are non-daemon, so the
    interpreter's atexit hook joins them on the way out, and a worker parked
    in a socket read inside yt-dlp never returns to be joined — the server
    stops answering but refuses to die, which reads as a crash.

    Cancelling every job first is what makes the join finish: the workers
    already poll that flag, so a download in progress unwinds at its next
    progress callback instead of running to completion. `cancel_futures`
    then drops the tracks that never started. A thread inside the search
    step has no such callback and is bounded only by its socket timeout, so
    this shortens shutdown rather than guaranteeing it is instant.
    """
    for job in list(_jobs.values()):
        job.stop.set()
    _executor.shutdown(wait=False, cancel_futures=True)


def _measure(path: Path) -> tuple[float, int] | None:
    """(mtime of the newest file, total bytes) for one job directory."""
    try:
        newest, total = path.stat().st_mtime, 0
        for child in path.iterdir():
            stat = child.stat()
            newest = max(newest, stat.st_mtime)
            total += stat.st_size
    except OSError:
        return None  # vanished under us, or unreadable — leave it alone
    return newest, total


def _evict(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
    _jobs.pop(path.name, None)


def _sweep(
    ttl_hours: float = DOWNLOADS_TTL_HOURS, max_bytes: int = DOWNLOADS_MAX_BYTES
) -> int:
    """Delete expired job directories, then any excess over the disk budget.

    Either pass is disabled by passing 0 or less for its limit; with both off
    this does nothing at all, and returns before walking the directory rather
    than stat()ing a library that nothing is allowed to delete.

    Returns how many were removed. A running job is never touched, so a
    volume held over budget entirely by jobs in flight stays over — the
    concurrency and per-client caps are what bound that case.
    """
    if ttl_hours <= 0 and max_bytes <= 0:
        return 0
    if not DOWNLOADS_DIR.exists():
        return 0
    cutoff = time.time() - ttl_hours * 3600 if ttl_hours > 0 else None
    removed = 0
    # (newest mtime, bytes, path) for everything that survived the TTL pass.
    survivors: list[tuple[float, int, Path]] = []

    for path in DOWNLOADS_DIR.iterdir():
        if not path.is_dir():
            continue
        job = _jobs.get(path.name)
        if job and not job.finished:
            continue  # never pull files out from under a running job
        measured = _measure(path)
        if measured is None:
            continue
        newest, size = measured
        if cutoff is not None and newest < cutoff:
            _evict(path)
            removed += 1
        else:
            survivors.append((newest, size, path))

    if max_bytes <= 0:
        return removed

    # Oldest first, so what goes is what someone is least likely to still want.
    total = sum(size for _, size, _ in survivors)
    survivors.sort()
    for _, size, path in survivors:
        if total <= max_bytes:
            break
        _evict(path)
        total -= size
        removed += 1
    return removed


def start_sweeper() -> None:
    """Cleanup thread on _SWEEP_INTERVAL_SECONDS; also sweeps leftovers from
    previous runs."""

    def loop() -> None:
        while True:
            try:
                _sweep()
            except Exception:
                pass  # a failed sweep must never kill the thread
            time.sleep(_SWEEP_INTERVAL_SECONDS)

    threading.Thread(target=loop, name="downloads-sweeper", daemon=True).start()
