"""Which cause a failed track reports.

Every attempt but the last searches YouTube; the last one searches SoundCloud.
So when YouTube bot-checks the server, the error left in hand at the end
belongs to some unrelated SoundCloud upload, and reporting it verbatim tells
the operator to go fix a track that was never the problem.
"""

import pytest

from app import downloader
from app.models import Track


def _track() -> Track:
    return Track(
        id="1",
        title="Harder, Better, Faster, Stronger",
        artists=["Daft Punk"],
        album="Discovery",
        duration_ms=226000,
        cover_url=None,
    )


def _fail_with(monkeypatch, errors: list[str]) -> None:
    """Make each attempt find a source and then fail with the next message."""
    remaining = list(errors)

    monkeypatch.setattr(downloader.shutil, "which", lambda _: "/usr/bin/ffmpeg")
    monkeypatch.setattr(downloader.time, "sleep", lambda _: None)
    monkeypatch.setattr(
        downloader,
        "search_source",
        lambda track, exclude=frozenset(), prefix="": f"https://example/{len(remaining)}",
    )

    def fake_download(*args, **kwargs):
        raise RuntimeError(remaining.pop(0))

    monkeypatch.setattr(downloader, "download_audio", fake_download)


def test_bot_check_wins_over_the_soundcloud_fallbacks_complaint(monkeypatch, tmp_path):
    _fail_with(
        monkeypatch,
        [
            "ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies",
            "ERROR: [youtube] y: Sign in to confirm you’re not a bot. Use --cookies",
            "ERROR: [youtube] z: Sign in to confirm you’re not a bot. Use --cookies",
            "ERROR: [soundcloud] 254111788: This video is DRM protected",
        ],
    )

    with pytest.raises(downloader.DownloadError) as exc:
        downloader.download_track(_track(), tmp_path, on_progress=lambda *_: None)

    assert "not a bot" in str(exc.value)
    assert "YTDLP_COOKIEFILE" in str(exc.value)
    assert "DRM" not in str(exc.value)


def test_an_ordinary_failure_still_reports_what_actually_happened(monkeypatch, tmp_path):
    _fail_with(
        monkeypatch,
        [
            "ERROR: [youtube] x: Video unavailable",
            "ERROR: [youtube] y: Video unavailable",
            "ERROR: [youtube] z: Video unavailable",
            "ERROR: [soundcloud] 254111788: This video is DRM protected",
        ],
    )

    with pytest.raises(downloader.DownloadError) as exc:
        downloader.download_track(_track(), tmp_path, on_progress=lambda *_: None)

    assert "DRM protected" in str(exc.value)
    assert "YTDLP_COOKIEFILE" not in str(exc.value)


def test_page_needs_to_be_reloaded_triggers_bot_check(monkeypatch, tmp_path):
    _fail_with(
        monkeypatch,
        [
            "ERROR: [youtube] x: The page needs to be reloaded.",
            "ERROR: [youtube] y: The page needs to be reloaded.",
            "ERROR: [youtube] z: The page needs to be reloaded.",
            "ERROR: [soundcloud] 254111788: This video is DRM protected",
        ],
    )

    with pytest.raises(downloader.DownloadError) as exc:
        downloader.download_track(_track(), tmp_path, on_progress=lambda *_: None)

    assert "not a bot" in str(exc.value)
    assert "DRM" not in str(exc.value)
