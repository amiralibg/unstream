"""Tests for desktop backend seams and environment configuration."""

import os
from pathlib import Path
from starlette.testclient import TestClient

from app import jobs, main, ytdlp
from app.models import Track


def test_downloads_dir_env_var(monkeypatch, tmp_path):
    custom_dir = tmp_path / "custom_music"
    monkeypatch.setenv("UNSTREAM_DOWNLOADS_DIR", str(custom_dir))

    # Re-evaluate DOWNLOADS_DIR from env
    downloads = Path(
        os.getenv("UNSTREAM_DOWNLOADS_DIR", Path(jobs.__file__).resolve().parent.parent / "downloads")
    )
    assert downloads == custom_dir


def test_origin_middleware_allows_local_and_rejects_foreign():
    client = TestClient(main.app)

    # No origin header -> Allowed
    res = client.get("/health")
    assert res.status_code == 200

    # Localhost / 127.0.0.1 origins -> Allowed
    res = client.get("/health", headers={"origin": "http://localhost:5173"})
    assert res.status_code == 200

    res = client.get("/health", headers={"origin": "http://127.0.0.1:8000"})
    assert res.status_code == 200

    # Tauri schemes -> Allowed
    res = client.get("/health", headers={"origin": "tauri://localhost"})
    assert res.status_code == 200

    res = client.get("/health", headers={"origin": "https://tauri.localhost"})
    assert res.status_code == 200

    # Foreign origin -> Forbidden (403)
    res = client.get("/health", headers={"origin": "https://malicious-site.com"})
    assert res.status_code == 403
    assert "Forbidden origin" in res.text


def test_config_js_endpoint():
    client = TestClient(main.app)
    res = client.get("/config.js")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/javascript")
    assert "window.__UNSTREAM_CONFIG__" in res.text


def test_spa_static_files_fallback(tmp_path, monkeypatch):
    static_dir = tmp_path / "dist"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!doctype html><html><body>Unstream</body></html>")
    assets_dir = static_dir / "assets"
    assets_dir.mkdir()
    (assets_dir / "style.css").write_text("body { color: red; }")

    # Set up static dir handler
    monkeypatch.setenv("UNSTREAM_STATIC_DIR", str(static_dir))
    monkeypatch.setattr(main, "_static_dir", static_dir, raising=False)
    monkeypatch.setattr(main, "_index_file", static_dir / "index.html", raising=False)

    client = TestClient(main.app)

    # Root -> index.html
    res = client.get("/")
    assert res.status_code == 200
    assert "Unstream" in res.text

    # Real static asset -> static file
    res = client.get("/assets/style.css")
    assert res.status_code == 200
    assert "color: red" in res.text

    # SPA client-side route (/admin, /search) -> fallback to index.html
    res = client.get("/admin")
    assert res.status_code == 200
    assert "Unstream" in res.text

    # An unmatched /api path is never a client route. Serving index.html
    # there would hand an <img> a page instead of a cover and a JSON caller
    # an empty object instead of an error — which is exactly what a desktop
    # build with a newer frontend than backend does, silently.
    for path in ("/api/library/cover/deadbeef", "/api/nope", "/health/nope"):
        res = client.get(path)
        assert res.status_code == 404, path
        assert "Unstream" not in res.text, path


def test_job_and_track_paths(tmp_path):
    job_id = "test_job_paths_123"
    track = Track(
        id="t1",
        title="Test Song",
        artists=["Test Artist"],
        album="Test Album",
        duration_ms=180000,
        cover_url=None,
    )
    job = jobs.Job(id=job_id, name="Test Job")
    fake_file = tmp_path / "song.mp3"
    fake_file.write_text("fake audio")

    state = jobs.TrackState(track=track, filename="01 - Test Song")
    state.status = "done"
    state.file_path = fake_file
    job.tracks["t1"] = state

    jobs._jobs[job_id] = job

    client = TestClient(main.app)

    # Job path
    res = client.get(f"/api/jobs/{job_id}/path")
    assert res.status_code == 200
    data = res.json()
    assert "dir" in data
    assert "downloads_dir" in data

    # Track path
    res = client.get(f"/api/jobs/{job_id}/tracks/t1/path")
    assert res.status_code == 200
    data = res.json()
    assert data["path"] == str(fake_file.resolve())
    assert data["filename"] == "song.mp3"

    # Track not done -> 404
    state.status = "downloading"
    res = client.get(f"/api/jobs/{job_id}/tracks/t1/path")
    assert res.status_code == 404

    # Cleanup
    del jobs._jobs[job_id]


def test_youtube_disabled_flag(monkeypatch):
    monkeypatch.setenv("UNSTREAM_YOUTUBE_DISABLED", "true")

    called_yt = []
    monkeypatch.setattr(main.ytdlp, "search_youtube", lambda q, p: called_yt.append(True) or [])
    monkeypatch.setattr(main.deezer, "search", lambda q, p: [])
    monkeypatch.setattr(main.itunes, "search", lambda q, p: [])
    monkeypatch.setattr(main.soundcloud, "search", lambda q, p: [])

    main.search_any("test song", 0)
    assert len(called_yt) == 0


def test_desktop_config_endpoints(tmp_path):
    client = TestClient(main.app)
    custom_dir = tmp_path / "new_music_dir"

    # POST new downloads dir
    res = client.post("/api/desktop/config", json={"downloads_dir": str(custom_dir)})
    assert res.status_code == 200
    assert res.json()["downloads_dir"] == str(custom_dir.resolve())
    assert custom_dir.exists()

    # GET active downloads dir
    res = client.get("/api/desktop/config")
    assert res.status_code == 200
    assert res.json()["downloads_dir"] == str(custom_dir.resolve())


def test_cookies_from_browser_env_and_opts(monkeypatch):
    monkeypatch.setenv("YTDLP_COOKIES_FROM_BROWSER", "chrome")
    monkeypatch.setattr(ytdlp, "_cookies_from_browser", None)
    assert ytdlp.cookies_from_browser() == "chrome"
    assert ytdlp.base_opts()["cookiesfrombrowser"] == ("chrome",)

    # Unknown names are dropped, not passed to yt-dlp's OS-specific reader.
    monkeypatch.setenv("YTDLP_COOKIES_FROM_BROWSER", "netscape")
    assert ytdlp.cookies_from_browser() == ""
    assert "cookiesfrombrowser" not in ytdlp.base_opts()


def test_cookies_from_browser_live_switch(monkeypatch):
    monkeypatch.setattr(ytdlp, "_cookies_from_browser", None)
    try:
        assert ytdlp.set_cookies_from_browser("Firefox") == "firefox"
        assert ytdlp.base_opts()["cookiesfrombrowser"] == ("firefox",)
        assert ytdlp.set_cookies_from_browser("") == ""
        assert "cookiesfrombrowser" not in ytdlp.base_opts()
    finally:
        ytdlp._cookies_from_browser = None


def test_player_clients_env(monkeypatch):
    monkeypatch.setenv("YTDLP_PLAYER_CLIENTS", "tv, web, bogus name!")
    assert ytdlp.player_clients() == ["tv", "web", "bogus name!"]
    args = ytdlp.base_opts()["extractor_args"]
    assert args["youtube"]["player_client"] == ["tv", "web", "bogus name!"]

    monkeypatch.delenv("YTDLP_PLAYER_CLIENTS")
    assert ytdlp.player_clients() == []
    assert "extractor_args" not in ytdlp.base_opts()


def test_bot_check_message_names_the_fix_where_the_reader_is(monkeypatch):
    monkeypatch.delenv("UNSTREAM_DESKTOP", raising=False)
    assert "YTDLP_COOKIEFILE" in ytdlp.bot_check_message()

    monkeypatch.setenv("UNSTREAM_DESKTOP", "1")
    message = ytdlp.bot_check_message()
    assert "Browser cookies" in message
    assert "YTDLP_COOKIEFILE" not in message


def test_desktop_config_cookies_roundtrip(monkeypatch):
    monkeypatch.setattr(ytdlp, "_cookies_from_browser", None)
    client = TestClient(main.app)
    try:
        res = client.post("/api/desktop/config", json={"cookies_from_browser": "brave"})
        assert res.status_code == 200
        assert res.json()["cookies_from_browser"] == "brave"

        res = client.get("/api/desktop/config")
        assert res.json()["cookies_from_browser"] == "brave"

        res = client.post("/api/desktop/config", json={"cookies_from_browser": "netscape"})
        assert res.status_code == 400
    finally:
        ytdlp._cookies_from_browser = None



def test_poll_id_cap_is_liftable_for_the_desktop(monkeypatch):
    """A server bounds how many jobs one poll may ask about; the desktop
    doesn't, because a queued discography holds more jobs than the cap and
    the overflow would silently stop reporting progress."""
    from app import limits

    # Registered directly rather than through `start`, which would spawn
    # download threads this test has no use for.
    ids = []
    for i in range(4):
        job = jobs.Job(id=f"poll{i}", name=f"job {i}", folder_name=f"job-{i}")
        jobs._jobs[job.id] = job
        ids.append(job.id)
    client = TestClient(main.app)
    query = ",".join(ids)

    monkeypatch.setattr(limits, "MAX_POLL_IDS", 2)
    assert len(client.get(f"/api/jobs?ids={query}").json()["jobs"]) == 2

    # 0 means no limit, the same as the other job caps.
    monkeypatch.setattr(limits, "MAX_POLL_IDS", 0)
    assert len(client.get(f"/api/jobs?ids={query}").json()["jobs"]) == 4
