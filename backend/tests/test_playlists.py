"""Playlists: storage, matching against the library, export and import."""

import json

import pytest
from starlette.testclient import TestClient

from app import jobs, main, playlists
from tests.test_library import _wav


@pytest.fixture
def env(monkeypatch, tmp_path):
    root = tmp_path / "music"
    root.mkdir()
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)
    monkeypatch.setattr(playlists, "PLAYLISTS_PATH", tmp_path / "data" / "playlists.json")
    monkeypatch.setenv("UNSTREAM_PLAYLISTS", "1")
    return root


def _song(title, artist="ZEDBAZI", **extra):
    return {"title": title, "artists": [artist], "duration_ms": 0} | extra


def test_off_unless_desktop(monkeypatch):
    monkeypatch.delenv("UNSTREAM_PLAYLISTS", raising=False)
    monkeypatch.delenv("UNSTREAM_DESKTOP", raising=False)
    assert TestClient(main.app).get("/api/playlists").status_code == 404
    monkeypatch.setenv("UNSTREAM_DESKTOP", "1")
    assert playlists.enabled()


def test_create_add_dedupe_reorder_remove(env):
    created = playlists.create("Road trip", [_song("Party"), _song("Party")])
    assert [e["title"] for e in created["tracks"]] == ["Party"]

    full, added, skipped = playlists.add_tracks(
        created["id"], [_song("Party (feat. Someone)"), _song("Ghalb")]
    )
    # A decoration on the title is the same song, not a second one.
    assert (added, skipped) == (1, 1)
    uids = [e["uid"] for e in full["tracks"]]

    reordered = playlists.update(created["id"], order=list(reversed(uids)))
    assert [e["title"] for e in reordered["tracks"]] == ["Ghalb", "Party"]

    # A partial order keeps the songs it left out, at the end.
    partial = playlists.update(created["id"], order=[uids[0]])
    assert [e["uid"] for e in partial["tracks"]] == [uids[0], uids[1]]

    left = playlists.remove_track(created["id"], uids[0])
    assert [e["title"] for e in left["tracks"]] == ["Ghalb"]

    playlists.delete(created["id"])
    with pytest.raises(playlists.NotFound):
        playlists.get(created["id"])


def test_entries_match_files_on_disk(env):
    _wav(env / "job" / "ZEDBAZI - Party.wav", title="Party", artist="ZEDBAZI, Hichkas", cover=True)
    created = playlists.create("Mix", [_song("Party"), _song("Not downloaded")])
    on_disk, missing = created["tracks"]
    assert on_disk["file_id"] and on_disk["file"] == "job/ZEDBAZI - Party.wav"
    assert on_disk["cover"] == f"/api/library/cover/{on_disk['file_id']}"
    assert missing["file_id"] is None

    summary = playlists.list_all()[0]
    assert (summary["count"], summary["on_disk"]) == (2, 1)

    name, tracks = playlists.missing_tracks(created["id"])
    assert name == "Mix" and [t.title for t in tracks] == ["Not downloaded"]
    assert tracks[0].id == missing["uid"]


def test_adding_from_library_stores_the_path(env):
    from app import library

    _wav(env / "Only Local.wav")
    file_id = library.scan()[0].id
    created = playlists.create("Local", [{"title": "Only Local", "file_id": file_id}])
    assert created["tracks"][0]["file"] == "Only Local.wav"
    assert created["tracks"][0]["file_id"] == file_id


def test_untrusted_fields_are_dropped(env):
    created = playlists.create(
        "x",
        [
            _song(
                "Song",
                source_url="file:///etc/passwd",
                cover_url="javascript:alert(1)",
                file="../../outside.mp3",
            ),
            {"title": ""},
            "nonsense",
        ],
    )
    (entry,) = created["tracks"]
    assert entry["source_url"] is None and entry["cover_url"] is None and entry["file"] == ""


def test_json_round_trip_through_export_and_import(env):
    _wav(env / "a" / "ZEDBAZI - Party.wav", title="Party", artist="ZEDBAZI")
    created = playlists.create(
        "Persian / Rap",
        [_song("Party"), _song("Online", source_url="https://youtu.be/x", duration_ms=1000)],
    )
    path = playlists.export(created["id"], "json")
    assert path.parent == env / "Playlists" and path.name.endswith(".unstream.json")

    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["format"] == playlists.FORMAT
    assert "uid" not in data["tracks"][0] and "file_id" not in data["tracks"][0]

    imported = playlists.import_text(path.read_text(encoding="utf-8"), path.name)
    # Same name is taken, so the copy is numbered rather than merged.
    assert imported["name"] == "Persian / Rap (2)"
    assert [e["title"] for e in imported["tracks"]] == ["Party", "Online"]
    assert imported["tracks"][0]["file_id"] and imported["tracks"][1]["source_url"]


def test_m3u_export_and_import(env):
    _wav(env / "a" / "ZEDBAZI - Party.wav", title="Party", artist="ZEDBAZI")
    created = playlists.create(
        "Mix",
        [
            _song("Party"),
            _song("Online", source_url="https://youtu.be/x", duration_ms=200_000),
            _song("Nowhere"),
        ],
    )
    text = playlists.export(created["id"], "m3u8").read_text(encoding="utf-8")
    assert text.splitlines() == [
        "#EXTM3U",
        "#PLAYLIST:Mix",
        "#EXTINF:-1,ZEDBAZI - Party",
        "../a/ZEDBAZI - Party.wav",
        "#EXTINF:200,ZEDBAZI - Online",
        "https://youtu.be/x",
    ]
    imported = playlists.import_text(text, "Mix.m3u8")
    assert [(e["title"], e["artists"]) for e in imported["tracks"]] == [
        ("Party", ["ZEDBAZI"]),
        ("Online", ["ZEDBAZI"]),
    ]
    assert imported["tracks"][0]["file_id"]


def test_import_rejects_what_it_cannot_read(env):
    for text in ("hello", "{}", json.dumps({"format": playlists.FORMAT, "version": 99})):
        with pytest.raises(playlists.PlaylistError):
            playlists.import_text(text, "x.json")
    with pytest.raises(playlists.PlaylistError):
        playlists.import_text(
            json.dumps({"format": playlists.FORMAT, "version": 1, "name": "x", "tracks": []}),
            "x.json",
        )


def test_corrupt_file_is_never_overwritten(env):
    playlists.PLAYLISTS_PATH.parent.mkdir(parents=True)
    playlists.PLAYLISTS_PATH.write_text("{not json")
    with pytest.raises(playlists.PlaylistError):
        playlists.create("x")
    assert playlists.PLAYLISTS_PATH.read_text() == "{not json"


def test_api_flow_and_download_of_missing_songs(env, monkeypatch):
    _wav(env / "a" / "ZEDBAZI - Party.wav", title="Party", artist="ZEDBAZI")
    started = {}

    def fake_start(name, tracks, quality, **kwargs):
        started.update(name=name, titles=[t.title for t in tracks], quality=quality)

        class _Job:
            id = "job123"

        return _Job()

    monkeypatch.setattr(jobs, "start", fake_start)
    client = TestClient(main.app)

    made = client.post("/api/playlists", json={"name": "Mix", "tracks": [_song("Party")]}).json()
    added = client.post(
        f"/api/playlists/{made['id']}/tracks", json={"tracks": [_song("New one")]}
    ).json()
    assert (added["added"], added["skipped"]) == (1, 0)

    res = client.post(f"/api/playlists/{made['id']}/download", json={"quality": "320"})
    assert res.status_code == 200
    assert started == {"name": "Mix", "titles": ["New one"], "quality": "320"}
    assert res.json()["tracks"][0]["title"] == "New one"

    uid = added["playlist"]["tracks"][1]["uid"]
    client.delete(f"/api/playlists/{made['id']}/tracks/{uid}")
    res = client.post(f"/api/playlists/{made['id']}/download", json={})
    assert res.status_code == 400 and res.json()["detail"].startswith("Everything is already")

    assert client.patch(f"/api/playlists/{made['id']}", json={"name": " "}).status_code == 400
    assert client.get("/api/playlists/nope").status_code == 404
    assert client.delete(f"/api/playlists/{made['id']}").json() == {"ok": True}
    assert client.get("/api/playlists").json() == {"playlists": []}


def test_download_one_song_by_metadata(monkeypatch):
    started = {}

    def fake_start(name, tracks, quality, **kwargs):
        started.update(name=name, tracks=tracks, quality=quality)

        class _Job:
            id = "job1"

        return _Job()

    monkeypatch.setattr(jobs, "start", fake_start)
    client = TestClient(main.app)

    res = client.post(
        "/api/download/song",
        json={"title": "Party", "artists": ["ZEDBAZI"], "quality": "192", "source_url": "javascript:x"},
    )
    assert res.status_code == 200
    assert res.json()["name"] == "ZEDBAZI - Party"
    (track,) = started["tracks"]
    assert track.title == "Party" and track.source_url is None and started["quality"] == "192"

    assert client.post("/api/download/song", json={"title": "  "}).status_code == 400
    assert client.post("/api/download/song", json={"title": "x", "quality": "9"}).status_code == 400
