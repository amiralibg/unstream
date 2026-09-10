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

DOWNLOADS_DIR = Path(
    os.getenv("UNSTREAM_DOWNLOADS_DIR", Path(__file__).resolve().parent.parent / "downloads")
)


def set_downloads_dir(path: str | Path) -> str:
    global DOWNLOADS_DIR
    p = Path(path).resolve()
    p.mkdir(parents=True, exist_ok=True)
    DOWNLOADS_DIR = p
    return str(DOWNLOADS_DIR)

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


SETTLED = ("done", "error", "cancelled")


@dataclass
class TrackState:
    track: Track
    filename: str  # unique stem within the job, no extension
    # queued | searching | downloading | tagging | retrying | done | error | cancelled
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    file_path: Path | None = None
    # Bumped every time this track is called off or re-queued. A worker
    # captures it when it starts and compares on every check, so a cancel
    # is per-track: clearing the job-wide flag to retry one track cannot
    # hand a still-running worker permission to carry on. See `cancel()`.
    generation: int = 0

    def as_dict(self) -> dict:
        return {
            "id": self.track.id,
            "status": self.status,
            "progress": round(self.progress, 3),
            "error": self.error,
            # "mp3" / "m4a" / "opus" — the UI labels its save link with it.
            "ext": self.file_path.suffix.lstrip(".") if self.file_path else None,
            "path": str(self.file_path.resolve()) if self.file_path else None,
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
    # Set once, by cancel(). An Event rather than a bool under `lock` so a
    # worker can ask mid-transfer, from inside a progress hook, without
    # queueing behind whatever else is writing track state.
    stopped: threading.Event = field(default_factory=threading.Event)

    folder_name: str = ""

    @property
    def dir(self) -> Path:
        target = self.folder_name or self.id
        return DOWNLOADS_DIR / target

    @property
    def finished(self) -> bool:
        with self.lock:
            return all(s.status in SETTLED for s in self.tracks.values())

    def as_dict(self) -> dict:
        with self.lock:
            states = [s.as_dict() for s in self.tracks.values()]
        done = sum(1 for s in states if s["status"] == "done")
        failed = sum(1 for s in states if s["status"] == "error")
        cancelled = sum(1 for s in states if s["status"] == "cancelled")
        return {
            "id": self.id,
            "name": self.name,
            "quality": self.quality,
            "dir": str(self.dir.resolve()),
            "tracks": states,
            "done": done,
            "failed": failed,
            "cancelled": cancelled,
            "total": len(states),
            "finished": done + failed + cancelled == len(states),
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
            if state.status not in SETTLED
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


def _run_track(job: Job, state: TrackState, generation: int) -> None:
    """Download one track, as the attempt identified by `generation`.

    The generation is handed in by whoever queued this attempt, never read
    off `state` here. A track can sit in the pool for a long time — `start()`
    submits the whole album at once — and by the time it runs, `state` may
    already belong to a later attempt. Reading the number at submit time is
    what lets this worker notice that it is the stale one and stand down,
    instead of racing the attempt that superseded it into the same filename.
    """

    def cancelled() -> bool:
        # Anything that calls the track off — a job-wide cancel, or a retry
        # that supersedes this attempt — bumps the generation, and every
        # check below then reads as "stop". Asking about our own generation
        # rather than only `job.stopped` is what keeps a cancel true for this
        # track after a retry of a *different* track clears that flag.
        return job.stopped.is_set() or state.generation != generation

    if cancelled():
        # Cancelled while this one sat in the pool's queue. cancel() has
        # already written the status; there is nothing to do but not start.
        return

    def on_progress(stage: str, fraction: float) -> None:
        with job.lock:
            # Reporting a stage after cancel() has settled this track would
            # walk it back out of a terminal state, and the UI would show a
            # cancelled download carrying on.
            if cancelled():
                return
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
            should_cancel=cancelled,
        )
        if cancelled():
            # Finished in the window between the cancel landing and the last
            # check inside the pipeline. Keeping it would mean a job answering
            # "cancelled" and then handing out one more file than it reported.
            path.unlink(missing_ok=True)
            return
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
        # cancel() writes this status too, and whichever gets there first wins
        # the same value. Not an error, and not counted as one: nothing failed.
        #
        # The generation check is for the other way this is reached: a retry
        # supersedes this attempt, and the abandoned worker unwinds *after*
        # the fresh one has already started. Writing "cancelled" then would
        # stamp a terminal status onto a download that is currently running.
        with job.lock:
            if state.generation == generation:
                state.status = "cancelled"
                state.progress = 0.0
    except Exception as exc:  # any failure marks just this track, not the job
        with job.lock:
            if state.generation != generation:
                return  # superseded by a retry; that attempt owns the status
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
    folder = downloader.safe_filename(name) or uuid.uuid4().hex[:12]
    job = Job(
        id=uuid.uuid4().hex[:12],
        name=name,
        folder_name=folder,
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
        _executor.submit(_run_track, job, state, state.generation)
    return job


def cancel(job: Job) -> int:
    """Stop every track that hasn't settled. Returns how many were stopped.

    The status is written here rather than left to the workers, so the job
    reports "cancelled" on the very next poll: a track stuck in a provider
    search cannot be interrupted mid-request and may take another few seconds
    to notice, and a button that does nothing visible for that long reads as
    broken. Whatever a worker is holding when it does notice is thrown away —
    files included — so the counts the job reported stay true.

    Tracks already finished keep their files. Cancelling an album halfway is
    "stop here", not "undo"; the finished songs stay downloadable until the
    sweeper takes them like any other job's.
    """
    job.stopped.set()
    stopped = 0
    with job.lock:
        for state in job.tracks.values():
            if state.status in SETTLED:
                continue
            # Bumped as well as flagged. `job.stopped` is cleared again the
            # moment anything in this job is retried, and without a per-track
            # mark a worker still unwinding from *this* cancel would read the
            # cleared flag as permission to finish the track it was told to
            # drop — the download would come back to life after the stop.
            state.generation += 1
            state.status = "cancelled"
            state.progress = 0.0
            stopped += 1
    return stopped


def _requeue(state: TrackState) -> None:
    """Reset one track for a fresh attempt. Caller holds `job.lock`.

    Bumping the generation is what retires whatever worker still holds this
    track — an attempt abandoned mid-flight, or one unwinding from a cancel.
    It keeps running until it next looks, and then finds it is no longer the
    attempt that owns the status, so it writes nothing.
    """
    state.generation += 1
    state.status = "queued"
    state.progress = 0.0
    state.error = None


def retry_track(job: Job, track_id: str) -> bool:
    """Re-queue a single failed/cancelled track. True if it was queued.

    Retrying anything clears the job-wide stop flag — the pool has to be
    allowed to run this track. Tracks the cancel already settled stay
    settled, because each carries its own generation: clearing the flag
    lets *this* attempt through and nothing else.
    """
    with job.lock:
        state = job.tracks.get(track_id)
        if not state or state.status not in ("error", "cancelled"):
            return False
        _requeue(state)
        job.stopped.clear()
        generation = state.generation
    _executor.submit(_run_track, job, state, generation)
    return True


def retry_failed(job: Job) -> int:
    """Re-queue every failed track in a job. Returns how many were queued.

    Failures only: a track someone cancelled was stopped on purpose, and
    "retry the ones that broke" must not restart it. Those come back one at
    a time through `retry_track`.
    """
    with job.lock:
        failed = [s for s in job.tracks.values() if s.status == "error"]
        if not failed:
            return 0
        for state in failed:
            _requeue(state)
        job.stopped.clear()
        queued = [(state, state.generation) for state in failed]
    for state, generation in queued:
        _executor.submit(_run_track, job, state, generation)
    return len(failed)


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
        if not job:
            # Check by folder_name
            job = next((j for j in _jobs.values() if j.folder_name == path.name or j.id == path.name), None)
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
