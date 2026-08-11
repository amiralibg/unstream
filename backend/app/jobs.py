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
# A completed job's files may live forever, but its in-memory progress record
# should not. This is intentionally separate from file retention: keeping a
# user's music does not require keeping every Python object forever.
JOB_METADATA_TTL_HOURS = float(os.getenv("JOB_METADATA_TTL_HOURS", "168"))
# 0 preserves the self-hosted "large discography" behaviour. Public profiles
# set this explicitly so many callers cannot grow the executor queue without
# bound.
MAX_QUEUED_TRACKS = max(0, int(os.getenv("MAX_QUEUED_TRACKS", "0")))
_executor = ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS)


@dataclass
class TrackState:
    track: Track
    filename: str  # unique stem within the job, no extension
    status: str = "queued"  # queued | searching | downloading | tagging | retrying | done | error
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


class QueueFullError(Exception):
    """The process cannot accept another track without unbounded queue growth."""


@dataclass
class Job:
    id: str
    name: str
    quality: str = downloader.DEFAULT_QUALITY
    # Opaque client key (an IP, from app.limits), only for counting a caller's
    # jobs in flight. Never leaves the process — as_dict() omits it, and job
    # ids stay unguessable so anyone holding one can still fetch it.
    owner: str = ""
    # Analytics only: a hashed, daily-rotating pseudonym, so a finished track
    # can be attributed without the download pipeline ever seeing an address.
    visitor: str = ""
    tracks: dict[str, TrackState] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    @property
    def dir(self) -> Path:
        return DOWNLOADS_DIR / self.id

    @property
    def finished(self) -> bool:
        with self.lock:
            return all(s.status in ("done", "error") for s in self.tracks.values())

    def as_dict(self) -> dict:
        with self.lock:
            states = [s.as_dict() for s in self.tracks.values()]
        done = sum(1 for s in states if s["status"] == "done")
        failed = sum(1 for s in states if s["status"] == "error")
        return {
            "id": self.id,
            "name": self.name,
            "quality": self.quality,
            "tracks": states,
            "done": done,
            "failed": failed,
            "total": len(states),
            "finished": done + failed == len(states),
        }


_jobs: dict[str, Job] = {}
_jobs_lock = threading.RLock()


def get(job_id: str) -> Job | None:
    with _jobs_lock:
        return _jobs.get(job_id)


def live_counts() -> dict:
    """What the process is doing right now — for the admin dashboard."""
    with _jobs_lock:
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
    with _jobs_lock:
        snapshot = list(_jobs.values())
    return sum(1 for job in snapshot if job.owner == owner and not job.finished)


def queued_tracks() -> int:
    """Number of tracks still queued or running in this process."""
    with _jobs_lock:
        snapshot = list(_jobs.values())
    count = 0
    for job in snapshot:
        with job.lock:
            count += sum(
                1
                for state in job.tracks.values()
                if state.status not in ("done", "error")
            )
    return count


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
    def on_progress(stage: str, fraction: float) -> None:
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
        )
        with job.lock:
            state.status = "done"
            state.progress = 1.0
            state.file_path = path
            if all(s.status in ("done", "error") for s in job.tracks.values()):
                job.finished_at = time.time()
        analytics.record(
            "track_done",
            visitor=job.visitor or None,
            source=_host_of(chosen["url"]),
            detail=job.quality,
            label=label,
            value=chosen["attempt"],
            ms=int((time.monotonic() - started) * 1000),
        )
    except Exception as exc:  # any failure marks just this track, not the job
        with job.lock:
            state.status = "error"
            state.error = str(exc)
            if all(s.status in ("done", "error") for s in job.tracks.values()):
                job.finished_at = time.time()
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
    owner: str = "",
    visitor: str = "",
) -> Job:
    job = Job(
        id=uuid.uuid4().hex,
        name=name,
        quality=quality,
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
    with _jobs_lock:
        # Keep the capacity check and registry insert atomic. Without the
        # shared lock, two simultaneous requests could both pass the check.
        if MAX_QUEUED_TRACKS > 0 and queued_tracks() + len(job.tracks) > MAX_QUEUED_TRACKS:
            raise QueueFullError(
                f"The download queue is full ({MAX_QUEUED_TRACKS} tracks)."
            )
        _jobs[job.id] = job
    for state in job.tracks.values():
        _executor.submit(_run_track, job, state)
    return job


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
    with _jobs_lock:
        _jobs.pop(path.name, None)


def _prune_metadata(now: float | None = None) -> int:
    """Drop old finished progress records without touching retained files."""
    if JOB_METADATA_TTL_HOURS <= 0:
        return 0
    cutoff = (time.time() if now is None else now) - JOB_METADATA_TTL_HOURS * 3600
    with _jobs_lock:
        old = [
            job_id
            for job_id, job in _jobs.items()
            if job.finished_at is not None and job.finished_at < cutoff
        ]
        for job_id in old:
            _jobs.pop(job_id, None)
    return len(old)


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
    removed = _prune_metadata()
    if ttl_hours <= 0 and max_bytes <= 0:
        return removed
    if not DOWNLOADS_DIR.exists():
        return removed
    cutoff = time.time() - ttl_hours * 3600 if ttl_hours > 0 else None
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
