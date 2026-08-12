"""Stopping a download that is already under way.

A thread pool cannot interrupt a running task, so cancellation here is an
agreement rather than a kill: `cancel` sets a flag, and the worker checks it
often enough that the user sees the download stop within a second or so.
That leaves three things worth pinning down, all of which were wrong in the
obvious first implementation:

* the tracks that already finished keep their files — the user asked to stop
  the rest, not to throw away what they waited for;
* a stopped job reads as finished, or it would be polled forever, held out of
  the sweeper's reach, and counted against the caller's job limit for good;
* a worker unwinding after the flag is set cannot resurrect a track it was
  midway through, which is what a late progress callback would otherwise do.
"""

import pytest

from app import downloader, jobs
from app.models import Track


def make_track(track_id: str = "t1") -> Track:
    return Track(
        id=track_id,
        title=f"Song {track_id}",
        artists=["Artist"],
        album="Album",
        duration_ms=180_000,
        cover_url=None,
    )


@pytest.fixture
def job() -> jobs.Job:
    """A job of four tracks, one of each interesting status."""
    job = jobs.Job(id="j1", name="Album")
    for track_id, status in (
        ("done", "done"),
        ("failed", "error"),
        ("running", "downloading"),
        ("waiting", "queued"),
    ):
        job.tracks[track_id] = jobs.TrackState(
            track=make_track(track_id), filename=track_id, status=status
        )
    return job


def test_cancel_stops_only_what_had_not_settled(job):
    assert jobs.cancel(job) == 2  # the downloading one and the queued one

    statuses = {tid: state.status for tid, state in job.tracks.items()}
    assert statuses == {
        "done": "done",  # keeps its file
        "failed": "error",  # already had its own outcome
        "running": "cancelled",
        "waiting": "cancelled",
    }


def test_a_cancelled_job_is_finished(job):
    """Otherwise it is polled forever and never releases its job slot."""
    assert not job.finished

    jobs.cancel(job)

    assert job.finished
    assert jobs.active_count(job.owner) == 0
    payload = job.as_dict()
    assert payload["finished"] is True
    assert payload["cancelled"] is True
    # What survived is still reported, because it is still downloadable.
    assert (payload["done"], payload["failed"], payload["total"]) == (1, 1, 4)


def test_cancelling_twice_stops_nothing_the_second_time(job):
    jobs.cancel(job)

    assert jobs.cancel(job) == 0  # idempotent: the endpoint may be tapped twice


def test_a_finished_job_reports_cancelled_only_if_it_was(job):
    assert job.as_dict()["cancelled"] is False


def test_a_queued_track_never_starts_downloading(job, monkeypatch):
    """Cancelling a long job leaves most of it sitting in the pool queue.

    Those tasks still run — nothing removes them — so the check has to be the
    first thing the worker does, before it reaches the downloader at all.
    """
    monkeypatch.setattr(
        downloader,
        "download_track",
        lambda *a, **kw: pytest.fail("started a track after the job was cancelled"),
    )
    jobs.cancel(job)

    jobs._run_track(job, job.tracks["waiting"])

    assert job.tracks["waiting"].status == "cancelled"


def test_a_late_progress_report_cannot_revive_a_cancelled_track(job, monkeypatch):
    """The worker mid-download unwinds through the downloader's own stages.

    `cancel` writes the final status immediately so the next poll is honest;
    a stage report arriving from the thread that is still winding down must
    not overwrite it with "searching".
    """

    def stop_midway(track, out_dir, on_progress, **kwargs):
        jobs.cancel(job)
        on_progress("searching", 0.0)  # the unwinding worker's last words
        raise downloader.Cancelled("cancelled by the user")

    monkeypatch.setattr(downloader, "download_track", stop_midway)

    jobs._run_track(job, job.tracks["running"])

    assert job.tracks["running"].status == "cancelled"


def test_a_cancelled_track_is_not_an_error(job, monkeypatch):
    """"error" would put a red "failed" on a row the user chose to stop."""

    def cancelled(*args, **kwargs):
        raise downloader.Cancelled("cancelled by the user")

    monkeypatch.setattr(downloader, "download_track", cancelled)
    job.stop.set()  # set, but the statuses deliberately left untouched

    jobs._run_track(job, job.tracks["running"])

    state = job.tracks["running"]
    assert state.status == "cancelled"
    assert state.error is None


def test_the_downloader_refuses_to_start_when_already_cancelled(tmp_path):
    """The last line of defence: no search, no network, no partial file."""
    stages: list[str] = []

    with pytest.raises(downloader.Cancelled):
        downloader.download_track(
            make_track(),
            tmp_path,
            lambda stage, fraction: stages.append(stage),
            should_cancel=lambda: True,
        )

    assert stages == []
    assert list(tmp_path.iterdir()) == []
