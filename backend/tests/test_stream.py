"""Streaming: range bounding, the source cache, and the relay endpoint."""

import io
import time
import urllib.error

import pytest
from starlette.testclient import TestClient

from app import main, stream
from app.models import Track


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setenv("UNSTREAM_STREAMING", "1")
    stream._cache.clear()
    stream._key_locks.clear()


def _track(**extra):
    return Track(
        id="s",
        title="Party",
        artists=["ZEDBAZI"],
        album="",
        duration_ms=200_000,
        cover_url=None,
        **extra,
    )


class _Upstream(io.BytesIO):
    def __init__(self, data: bytes, status: int = 206, headers: dict | None = None):
        super().__init__(data)
        self.status = status
        self.headers = headers or {}


def test_ranges_are_bounded_to_one_chunk():
    chunk = stream.CHUNK_BYTES
    assert stream._bounded(None) == f"bytes=0-{chunk - 1}"
    assert stream._bounded("bytes=0-") == f"bytes=0-{chunk - 1}"
    assert stream._bounded("bytes=100-") == f"bytes=100-{100 + chunk - 1}"
    assert stream._bounded("bytes=100-199") == "bytes=100-199"
    # A suffix range is how a player reads an index at the end of the file.
    assert stream._bounded("bytes=-500") == "bytes=-500"
    assert stream._bounded("nonsense") == f"bytes=0-{chunk - 1}"


def test_expiry_comes_from_the_url():
    expires = int(time.time()) + 6 * 3600
    got = stream._expiry(f"https://rr1.googlevideo.com/videoplayback?expire={expires}&x=1")
    assert got == expires - stream._EXPIRY_MARGIN
    assert stream._expiry("https://cdn.example/a.mp3") > time.time()


def test_resolution_is_cached_per_song(monkeypatch):
    calls = []

    def fake_find(track):
        calls.append(track.title)
        return stream.Source("https://media/a", {}, "m4a", time.time() + 600)

    monkeypatch.setattr(stream, "_find", fake_find)
    stream.resolve(_track())
    stream.resolve(_track())
    assert calls == ["Party"]
    stream.resolve(_track(), fresh=True)
    assert calls == ["Party", "Party"]


def test_a_dead_url_is_resolved_again(monkeypatch):
    sources = iter(
        [
            stream.Source("https://media/old", {}, "m4a", time.time() + 600),
            stream.Source("https://media/new", {"User-Agent": "x"}, "m4a", time.time() + 600),
        ]
    )
    monkeypatch.setattr(stream, "_find", lambda track: next(sources))
    seen = []

    def fake_urlopen(request, timeout):
        seen.append((request.full_url, request.get_header("Range")))
        if request.full_url.endswith("old"):
            raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)
        return _Upstream(b"abc", headers={"Content-Range": "bytes 0-2/3", "Content-Length": "3"})

    monkeypatch.setattr(stream.urllib.request, "urlopen", fake_urlopen)
    relay = stream.open_relay(_track(), "bytes=0-")
    assert relay.status == 206
    assert relay.headers["Content-Type"] == "audio/mp4"
    assert b"".join(relay.body) == b"abc"
    assert [url for url, _ in seen] == ["https://media/old", "https://media/new"]


def test_endpoint_relays_and_head_only_resolves(monkeypatch):
    monkeypatch.setattr(
        stream, "_find", lambda track: stream.Source("https://media/a", {}, "webm", time.time() + 600)
    )
    monkeypatch.setattr(
        stream.urllib.request,
        "urlopen",
        lambda request, timeout: _Upstream(
            b"0123", headers={"Content-Range": "bytes 0-3/10", "Content-Length": "4"}
        ),
    )
    client = TestClient(main.app)
    params = {"title": "Party", "artist": "ZEDBAZI", "duration_ms": 200000}

    res = client.get("/api/stream", params=params, headers={"Range": "bytes=0-"})
    assert res.status_code == 206
    assert res.content == b"0123"
    assert res.headers["content-range"] == "bytes 0-3/10"
    assert res.headers["content-type"] == "audio/webm"

    head = client.head("/api/stream", params=params)
    assert head.status_code == 200 and head.content == b""


def test_endpoint_reports_a_song_it_cannot_find(monkeypatch):
    def nothing(track):
        raise stream.StreamError("Could not find this song to play: no results")

    monkeypatch.setattr(stream, "_find", nothing)
    res = TestClient(main.app).get("/api/stream", params={"title": "x"})
    assert res.status_code == 502


def test_endpoint_is_off_on_a_server(monkeypatch):
    monkeypatch.setenv("UNSTREAM_STREAMING", "0")
    assert TestClient(main.app).get("/api/stream", params={"title": "x"}).status_code == 404


def test_find_falls_through_sources(monkeypatch):
    pages = []

    def fake_search(track, exclude, prefix):
        return f"https://{prefix}/hit"

    def fake_extract(page):
        pages.append(page)
        if "ytsearch" in page or "own" in page:
            raise RuntimeError("blocked")
        return stream.Source(page, {}, "mp3", time.time() + 60)

    monkeypatch.setattr(stream.downloader, "search_source", fake_search)
    monkeypatch.setattr(stream, "_extract", fake_extract)
    got = stream._find(_track(source_url="https://own/page"))
    assert got.url == "https://scsearch5/hit"
    assert pages == ["https://own/page", "https://ytsearch8/hit", "https://scsearch5/hit"]


def test_pinned_clients_are_dropped_on_a_youtube_failure(monkeypatch):
    from app import ytdlp

    seen = []

    class FakeYDL:
        def __init__(self, opts):
            self.opts = opts

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def action(ydl):
        clients = (ydl.opts.get("extractor_args") or {}).get("youtube", {}).get("player_client")
        seen.append(clients)
        if clients:
            raise ytdlp.YtdlpError("ERROR: [youtube] x: The page needs to be reloaded.")
        return "ok"

    monkeypatch.setattr(ytdlp, "YoutubeDL", FakeYDL)
    opts = {"extractor_args": {"youtube": {"player_client": ["tv", "web"]}}}
    assert ytdlp.run(opts, action) == "ok"
    assert seen == [["tv", "web"], None]

    # Nothing pinned, or not YouTube's refusal: the error is the answer.
    with pytest.raises(ytdlp.YtdlpError):
        ytdlp.run({}, lambda ydl: (_ for _ in ()).throw(ytdlp.YtdlpError("[youtube] boom")))
    with pytest.raises(ytdlp.YtdlpError):
        ytdlp.run(opts, lambda ydl: (_ for _ in ()).throw(ytdlp.YtdlpError("[soundcloud] boom")))


def test_segmented_only_uploads_are_fetched_whole_and_served_with_ranges(monkeypatch, tmp_path):
    song = tmp_path / "song.opus"
    song.write_bytes(bytes(range(256)) * 4)  # 1024 bytes

    def no_single_file(opts, action):
        raise stream.DownloadError("ERROR: [soundcloud] 1: Requested format is not available.")

    monkeypatch.setattr(stream.ytdlp, "run", no_single_file)
    monkeypatch.setattr(
        stream,
        "_fetch_whole",
        lambda page: stream.Source("", {}, "opus", time.time() + 60, path=song),
    )
    source = stream._extract("https://soundcloud.com/a/b")
    assert source.path == song

    monkeypatch.setattr(stream, "_find", lambda track: source)
    relay = stream.open_relay(_track(), "bytes=1000-")
    assert relay.status == 206
    assert relay.headers["Content-Range"] == "bytes 1000-1023/1024"
    assert b"".join(relay.body) == song.read_bytes()[1000:]
    tail = stream.open_relay(_track(), "bytes=-24")
    assert b"".join(tail.body) == song.read_bytes()[-24:]
