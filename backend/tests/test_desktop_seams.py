"""Tests for desktop backend seams and environment configuration."""

import os
from pathlib import Path
from starlette.testclient import TestClient

from app import jobs, main
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

