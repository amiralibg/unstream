"""What cancelling a download is allowed to do, and what it must leave alone.

Two things are easy to get wrong here and both are silent. A cancellation
travelling as an ordinary failure gets retried by `download_track`, which
means pressing stop starts three more downloads. And a worker that finishes
in the window after the cancel lands can walk its track back out of a
terminal state, which means a job reports "stopped" and then keeps going.
"""

import threading

import pytest

from app import downloader, jobs
from app.models import Track


def make_track(track_id: str) -> Track:
    return Track(
        id=track_id,
        title=f"Song {track_id}",
        artists=["Someone"],
        album="An album",
        duration_ms=180_000,
        cover_url=None,
        track_number=1,
        release_date="2020-01-01",
        preview_url=None,
    )


@pytest.fixture
def job() -> jobs.Job:
    """A job with three tracks and no workers — nothing here is running."""
    job = jobs.Job(id="j1", name="An album")
    for n in ("t1", "t2", "t3"):
        job.tracks[n] = jobs.TrackState(track=make_track(n), filename=n)
    return job


def test_cancel_settles_every_unfinished_track(job):
    job.tracks["t2"].status = "downloading"

    assert jobs.cancel(job) == 3
    assert [s.status for s in job.tracks.values()] == ["cancelled"] * 3
    assert job.finished
    assert job.as_dict()["cancelled"] == 3


def test_cancel_leaves_settled_tracks_as_they_were(job):
    job.tracks["t1"].status = "done"
    job.tracks["t2"].status = "error"
    job.tracks["t2"].error = "no audio file was produced"

    assert jobs.cancel(job) == 1  # only t3

    state = job.as_dict()
    assert state["done"] == 1
    assert state["failed"] == 1
    assert state["cancelled"] == 1
    assert state["finished"] is True
    assert job.tracks["t2"].error == "no audio file was produced"


def test_a_cancelled_job_is_not_reported_as_a_failure(job):
    """`failed` is what the UI colours red; a stopped job has nothing red in it."""
    jobs.cancel(job)

    assert job.as_dict()["failed"] == 0


def test_progress_after_a_cancel_cannot_revive_a_track(job, monkeypatch):
    """The worker's own progress callback is the thing that would do it."""
    state = job.tracks["t1"]

    def download(*args, **kwargs):
        on_progress = args[2]
        jobs.cancel(job)
        on_progress("downloading", 0.5)  # a hook already in flight
        raise downloader.Cancelled()

    monkeypatch.setattr(downloader, "download_track", download)
    jobs._run_track(job, state, state.generation)

    assert state.status == "cancelled"
    assert job.finished


def test_a_track_finishing_after_the_cancel_is_thrown_away(job, monkeypatch, tmp_path):
    """Keeping it would hand out one more file than the job reported."""
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", tmp_path)
    finished = tmp_path / job.id / "late.mp3"
    finished.parent.mkdir(parents=True)
    finished.write_bytes(b"\0" * 16)

    def download(*args, **kwargs):
        jobs.cancel(job)  # lands while this one is already past its last check
        return finished

    monkeypatch.setattr(downloader, "download_track", download)
    jobs._run_track(job, job.tracks["t1"], job.tracks["t1"].generation)

    assert job.tracks["t1"].status == "cancelled"
    assert job.tracks["t1"].file_path is None
    assert not finished.exists()


def test_a_queued_track_never_starts_after_a_cancel(job, monkeypatch):
    """The pool has already been handed every track; cancel cannot unqueue them."""
    jobs.cancel(job)
    monkeypatch.setattr(
        downloader,
        "download_track",
        lambda *a, **k: pytest.fail("started a track the job had cancelled"),
    )

    jobs._run_track(job, job.tracks["t1"], job.tracks["t1"].generation)

    assert job.tracks["t1"].status == "cancelled"


def test_a_cancel_stops_the_retries_instead_of_feeding_them(monkeypatch, tmp_path):
    """A failed attempt normally means "try another upload", four times over.

    Stubbed at `search_source`, which is where an attempt begins — one call
    means one attempt was started. Pressing stop while a track is retrying
    must not be the thing that starts the next three.
    """
    attempts = []
    stopped = threading.Event()

    def search(*args, **kwargs):
        attempts.append(1)
        return "https://example.invalid/watch?v=1"

    def download_audio(url, dest, on_progress=None, quality="192", should_cancel=None):
        stopped.set()  # someone presses stop while this attempt is failing
        raise downloader.DownloadError("403 Forbidden")

    monkeypatch.setattr(downloader, "search_source", search)
    monkeypatch.setattr(downloader, "download_audio", download_audio)
    monkeypatch.setattr(downloader.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    # The backoff between attempts is deliberately unhurried — a cancelled
    # worker waits it out before noticing, which costs nobody anything but a
    # test's runtime, since the job's own status flipped on the request.
    monkeypatch.setattr(downloader.time, "sleep", lambda seconds: None)

    with pytest.raises(downloader.Cancelled):
        downloader.download_track(
            make_track("t1"),
            tmp_path,
            lambda stage, fraction: None,
            should_cancel=stopped.is_set,
        )

    assert len(attempts) == 1  # not four, and not a DownloadError either


def test_a_cancelled_download_leaves_no_partial_files(monkeypatch, tmp_path):
    """A leftover .part is what makes a later download of the same track resume
    into a file that was never whole."""
    track = make_track("t1")
    stem = downloader.safe_filename(f"{', '.join(track.artists)} - {track.title}")
    partial = tmp_path / f"{stem}.webm.part"

    calls = {"n": 0}

    def download_audio(url, dest, on_progress=None, quality="192", should_cancel=None):
        calls["n"] += 1
        partial.write_bytes(b"\0" * 32)  # yt-dlp got some of the way in
        raise downloader.Cancelled()

    monkeypatch.setattr(downloader, "search_source", lambda *a, **k: "https://x.invalid/1")
    monkeypatch.setattr(downloader, "download_audio", download_audio)
    monkeypatch.setattr(downloader.shutil, "which", lambda name: "/usr/bin/ffmpeg")

    with pytest.raises(downloader.Cancelled):
        downloader.download_track(track, tmp_path, lambda stage, fraction: None)

    assert calls["n"] == 1  # not retried
    assert not partial.exists()


def test_retrying_one_track_does_not_revive_the_others(job, monkeypatch, tmp_path):
    """Retrying clears the job-wide stop flag; the other workers must not see it.

    A cancel lands while several tracks are in flight. One of them is past
    its last check and about to hand back a finished file — and the flag it
    would have been judged by has just been cleared underneath it by a retry
    of a *different* track. Without a per-track mark the file is kept and the
    row flips to "done", so a job that reported "stopped" hands out one more
    song than it ever admitted to.
    """
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", tmp_path)
    monkeypatch.setattr(jobs._executor, "submit", lambda *a, **k: None)
    job.tracks["t1"].status = "error"  # the one being retried
    finished = tmp_path / "late.mp3"
    finished.write_bytes(b"\0" * 16)

    def download(*args, **kwargs):
        """t2's worker, running through the cancel and the retry that follows."""
        jobs.cancel(job)
        jobs.retry_track(job, "t1")  # clears job.stopped underneath this worker
        return finished

    monkeypatch.setattr(downloader, "download_track", download)
    jobs._run_track(job, job.tracks["t2"], job.tracks["t2"].generation)

    assert job.stopped.is_set() is False  # the flag really was cleared
    assert job.tracks["t2"].status == "cancelled"  # and t2 stayed stopped anyway
    assert job.tracks["t2"].file_path is None
    assert not finished.exists()
    assert job.tracks["t1"].status == "queued"  # while the retried one is live


def test_a_superseded_worker_cannot_write_over_the_retry(job, monkeypatch):
    """The abandoned attempt unwinds after the fresh one has already started."""
    state = job.tracks["t1"]

    def download(*args, **kwargs):
        # The retry lands while this attempt is still on its way out.
        with job.lock:
            state.generation += 1
            state.status = "downloading"
        raise downloader.DownloadError("403 Forbidden")

    monkeypatch.setattr(downloader, "download_track", download)
    jobs._run_track(job, state, state.generation)

    assert state.status == "downloading"  # not stamped "error" by the old attempt
    assert state.error is None


def test_retry_all_leaves_cancelled_tracks_alone(job, monkeypatch):
    """"Retry the ones that broke" is not "undo the stop"."""
    job.tracks["t1"].status = "error"
    job.tracks["t2"].status = "cancelled"
    job.tracks["t3"].status = "done"

    monkeypatch.setattr(jobs._executor, "submit", lambda *a, **k: None)
    assert jobs.retry_failed(job) == 1

    assert job.tracks["t1"].status == "queued"
    assert job.tracks["t2"].status == "cancelled"
    assert job.tracks["t3"].status == "done"


def test_a_stale_pool_submission_stands_down(job, monkeypatch, tmp_path):
    """`start()` hands the pool every track at once, so a submission can still
    be waiting its turn when the track is cancelled and then retried. Two live
    attempts would write the same filename at the same time; the older one has
    to notice it is no longer the attempt that owns this track.
    """
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", tmp_path)
    monkeypatch.setattr(jobs._executor, "submit", lambda *a, **k: None)
    state = job.tracks["t1"]
    stale = state.generation  # what start() queued this attempt under

    jobs.cancel(job)
    assert jobs.retry_track(job, "t1") is True
    assert state.status == "queued"  # the fresh attempt now owns the track

    monkeypatch.setattr(
        downloader,
        "download_track",
        lambda *a, **k: pytest.fail("a superseded attempt started downloading"),
    )
    jobs._run_track(job, state, stale)

    assert state.status == "queued"  # left for the attempt that owns it
