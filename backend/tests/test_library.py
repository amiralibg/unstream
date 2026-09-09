"""The on-disk library: scan, tag reading, jail, streaming."""

import struct
import wave

from mutagen.id3 import APIC, TALB, TIT2, TPE1, USLT
from mutagen.wave import WAVE
from starlette.testclient import TestClient

from app import jobs, library, main


# A one-pixel JPEG: real magic bytes, so the mime sniff has something
# honest to read, and small enough to sit in a test file.
_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60 + b"\xff\xd9"


def _wav(path, title=None, artist=None, album=None, lyrics=False, cover=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(struct.pack("<4000h", *([0] * 4000)))
    if title or lyrics or cover:
        audio = WAVE(str(path))
        audio.add_tags()
        if title:
            audio["TIT2"] = TIT2(encoding=3, text=title)
        if artist:
            audio["TPE1"] = TPE1(encoding=3, text=artist)
        if album:
            audio["TALB"] = TALB(encoding=3, text=album)
        if lyrics:
            audio["USLT"] = USLT(encoding=3, lang="eng", desc="", text="la la")
        if cover:
            audio["APIC"] = APIC(
                encoding=3, mime="image/jpeg", type=3, desc="Cover", data=_JPEG
            )
        audio.save()


def _tree(tmp_path):
    root = tmp_path / "music"
    _wav(
        root / "ZEDBAZI - Party.wav",
        title="Party",
        artist="ZEDBAZI",
        lyrics=True,
        cover=True,
    )
    _wav(root / "album" / "No Tags Here.wav")
    (root / "notes.txt").write_text("not music")
    return root


def test_scan_lists_audio_with_tags_and_fallbacks(monkeypatch, tmp_path):
    root = _tree(tmp_path)
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)

    tracks = library.scan()
    assert len(tracks) == 2
    by_title = {t.title: t for t in tracks}

    tagged = by_title["Party"]
    assert tagged.artist == "ZEDBAZI"
    assert tagged.has_lyrics is True
    assert tagged.duration_ms > 0
    assert tagged.size > 0

    # No tags: "Artist - Title" split off the filename.
    assert "No Tags Here" in by_title

    # Newest first.
    assert tracks[0].mtime >= tracks[1].mtime


def test_scan_empty_or_missing_root(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", tmp_path / "nope")
    assert library.scan() == []


def test_stream_roundtrip_and_jail(monkeypatch, tmp_path):
    root = _tree(tmp_path)
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)
    client = TestClient(main.app)

    res = client.get("/api/library")
    assert res.status_code == 200
    tracks = res.json()["tracks"]
    assert len(tracks) == 2

    file_id = tracks[0]["id"]
    res = client.get(f"/api/library/file/{file_id}")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("audio/")
    assert len(res.content) > 1000

    # Unknown ids and ids from another root are 404, never a path.
    assert client.get("/api/library/file/0" * 10).status_code == 404
    other = tmp_path / "other"
    _wav(other / "Stranger.wav", title="Stranger")
    foreign = library._file_id(other, other / "Stranger.wav")
    assert client.get(f"/api/library/file/{foreign}").status_code == 404


def test_scan_reports_cover_and_reuses_tag_cache(monkeypatch, tmp_path):
    root = _tree(tmp_path)
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)
    library._tag_cache.clear()

    tracks = {t.title: t for t in library.scan()}
    assert tracks["Party"].has_cover is True
    assert tracks["No Tags Here"].has_cover is False

    # A second scan of an unchanged folder must not open a single file
    # again — that is the whole point of the cache, and what lets the
    # library view refetch while a download writes into the same folder.
    def explode(_path):
        raise AssertionError("re-read an unchanged file")

    monkeypatch.setattr(library, "_read_tags", explode)
    again = {t.title: t for t in library.scan()}
    assert again["Party"].artist == "ZEDBAZI"

    # Touching the file invalidates its entry, and only its entry.
    monkeypatch.undo()
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)
    target = root / "ZEDBAZI - Party.wav"
    _wav(target, title="Party II", artist="ZEDBAZI")
    assert {t.title for t in library.scan()} == {"Party II", "No Tags Here"}


def test_cover_endpoint_serves_art_and_revalidates(monkeypatch, tmp_path):
    root = _tree(tmp_path)
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)
    client = TestClient(main.app)

    tracks = client.get("/api/library").json()["tracks"]
    ids = {t["title"]: t["id"] for t in tracks}

    res = client.get(f"/api/library/cover/{ids['Party']}")
    assert res.status_code == 200
    # Sniffed from the bytes, not copied from the tag.
    assert res.headers["content-type"] == "image/jpeg"
    assert res.content == _JPEG
    etag = res.headers["etag"]

    # The <img> that already holds it asks once and is told nothing changed.
    res = client.get(
        f"/api/library/cover/{ids['Party']}", headers={"If-None-Match": etag}
    )
    assert res.status_code == 304

    # No art is a 404, so the UI falls back to its own glyph.
    assert client.get(f"/api/library/cover/{ids['No Tags Here']}").status_code == 404
    assert client.get("/api/library/cover/" + "0" * 40).status_code == 404


def test_lyrics_endpoint_prefers_the_synced_sidecar(monkeypatch, tmp_path):
    root = _tree(tmp_path)
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", root)
    client = TestClient(main.app)

    ids = {t["title"]: t["id"] for t in client.get("/api/library").json()["tracks"]}

    # Only the embedded frame so far: words, no timings.
    res = client.get(f"/api/library/lyrics/{ids['Party']}")
    assert res.status_code == 200
    assert res.json()["synced"] == ""
    assert res.json()["plain"] == "la la"

    # A sidecar written at download time is what karaoke actually needs.
    (root / "ZEDBAZI - Party.lrc").write_text(
        "[00:01.00] one\n[00:04.50] two\n", encoding="utf-8"
    )
    library._tag_cache.clear()
    res = client.get(f"/api/library/lyrics/{ids['Party']}")
    assert res.status_code == 200
    assert "[00:04.50]" in res.json()["synced"]

    # The sidecar also flips has_lyrics for a file carrying no frame at all.
    (root / "album" / "No Tags Here.lrc").write_text("[00:02.00] hey\n", encoding="utf-8")
    library._tag_cache.clear()
    tracks = {t["title"]: t for t in client.get("/api/library").json()["tracks"]}
    assert tracks["No Tags Here"]["has_lyrics"] is True

    # Nothing on disk is a 404 — the client's cue to go to the network.
    (root / "album" / "No Tags Here.lrc").unlink()
    library._tag_cache.clear()
    assert client.get(f"/api/library/lyrics/{ids['No Tags Here']}").status_code == 404
