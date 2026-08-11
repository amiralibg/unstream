"""What the downloads sweeper is allowed to delete.

The limits exist because a public server's disk is shared with strangers.
Someone self-hosting has the opposite problem — they want the files they
downloaded to still be there tomorrow — so both limits have an off switch,
and 0 is the value anyone would reach for to set it. These tests pin that
0 means "keep everything" and not, as it read literally before, "everything
is older than zero hours ago, delete it all".
"""

import os
import time

import pytest

from app import jobs

HOUR = 3600


@pytest.fixture
def downloads(tmp_path, monkeypatch):
    """A downloads directory the sweeper will walk, with no jobs in memory.

    _sweep() skips directories belonging to a job that is still running; an
    empty registry means every directory here is fair game, which is the
    case worth testing.
    """
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", tmp_path)
    monkeypatch.setattr(jobs, "_jobs", {})
    return tmp_path


def make_job_dir(root, name: str, *, age_hours: float = 0.0, size: int = 1024):
    """One finished job's folder, aged into the past."""
    path = root / name
    path.mkdir()
    (path / "track.mp3").write_bytes(b"\0" * size)
    when = time.time() - age_hours * HOUR
    # _measure() takes the newest mtime in the folder, so the file has to be
    # aged too — ageing only the directory would leave the file dated now.
    for target in (path / "track.mp3", path):
        os.utime(target, (when, when))
    return path


def test_ttl_zero_keeps_expired_downloads(downloads):
    old = make_job_dir(downloads, "ancient", age_hours=1000)

    assert jobs._sweep(ttl_hours=0, max_bytes=0) == 0
    assert old.exists()


def test_ttl_zero_with_a_disk_cap_still_enforces_the_cap(downloads):
    """Turning the clock off must not turn the disk budget off with it."""
    old = make_job_dir(downloads, "old", age_hours=100, size=800)
    new = make_job_dir(downloads, "new", age_hours=1, size=800)

    assert jobs._sweep(ttl_hours=0, max_bytes=1000) == 1
    assert not old.exists()  # oldest first
    assert new.exists()


def test_disk_cap_zero_keeps_everything_over_budget(downloads):
    big = make_job_dir(downloads, "big", age_hours=1, size=10_000)

    assert jobs._sweep(ttl_hours=24, max_bytes=0) == 0
    assert big.exists()


def test_ttl_still_expires_when_only_the_disk_cap_is_off(downloads):
    old = make_job_dir(downloads, "old", age_hours=48)
    fresh = make_job_dir(downloads, "fresh", age_hours=1)

    assert jobs._sweep(ttl_hours=24, max_bytes=0) == 1
    assert not old.exists()
    assert fresh.exists()


def test_both_limits_off_never_walks_the_directory(downloads, monkeypatch):
    """A library of thousands of files is not stat()ed every ten minutes to
    decide, each time, that nothing may be deleted."""
    make_job_dir(downloads, "kept", age_hours=1000)
    monkeypatch.setattr(
        jobs, "_measure", lambda path: pytest.fail("walked with both limits off")
    )

    assert jobs._sweep(ttl_hours=0, max_bytes=0) == 0


def test_defaults_still_expire_and_cap(downloads):
    """The public-server behaviour the defaults describe is unchanged."""
    old = make_job_dir(downloads, "old", age_hours=jobs.DOWNLOADS_TTL_HOURS + 1)
    fresh = make_job_dir(downloads, "fresh", age_hours=1)

    assert jobs._sweep() == 1
    assert not old.exists()
    assert fresh.exists()


def test_a_running_job_is_never_swept(downloads):
    path = make_job_dir(downloads, "running", age_hours=1000)
    job = jobs.Job(id="running", name="in flight")
    job.tracks["t1"] = jobs.TrackState(track=None, filename="t1", status="downloading")
    jobs._jobs["running"] = job

    assert jobs._sweep(ttl_hours=1, max_bytes=1) == 0
    assert path.exists()


def test_old_finished_metadata_is_pruned_even_when_files_are_kept(
    downloads, monkeypatch
):
    job = jobs.Job(id="old", name="finished")
    job.finished_at = time.time() - 2 * HOUR
    jobs._jobs["old"] = job
    monkeypatch.setattr(jobs, "JOB_METADATA_TTL_HOURS", 1)

    assert jobs._sweep(ttl_hours=0, max_bytes=0) == 1
    assert "old" not in jobs._jobs
