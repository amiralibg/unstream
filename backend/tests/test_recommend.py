"""Autoplay suggestions: seed lookup, filtering, top-up and on-disk matching."""

import pytest
from starlette.testclient import TestClient

from app import deezer, jobs, main, recommend
from tests.test_library import _wav


def _item(i, title, artist, artist_id=1):
    return {
        "id": i,
        "title": title,
        "duration": 200,
        "artist": {"id": artist_id, "name": artist},
        "album": {"title": "A", "cover_big": "https://img/x.jpg"},
    }


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setattr(jobs, "DOWNLOADS_DIR", tmp_path)
    calls = []
    responses = {}

    def fake_get(path, **params):
        calls.append((path, params))
        return responses.get(path, {"data": []})

    monkeypatch.setattr(deezer, "_get", fake_get)
    # Never the network: the fallback is opted into by the tests about it.
    monkeypatch.setattr(recommend, "_youtube_mix", lambda title, artist, limit: [])
    return responses, calls, tmp_path


def test_radio_of_the_matching_artist_without_the_seed(api):
    responses, calls, _ = api
    responses["/search/track"] = {
        "data": [_item(9, "Bohemian Rhapsody", "Queen Tribute", 7), _item(1, "Bohemian Rhapsody", "Queen", 412)]
    }
    responses["/artist/412/radio"] = {
        "data": [
            _item(1, "Bohemian Rhapsody", "Queen", 412),
            _item(2, "Headlong", "Queen", 412),
            _item(3, "Headlong", "Queen", 412),
        ]
        + [_item(10 + i, f"Song {i}", "Other") for i in range(30)]
    }
    got = recommend.similar("Bohemian Rhapsody", "Queen")
    assert len(got) == recommend.MAX_RESULTS
    # Shuffled before it is cut to size, so which songs survive the cut is
    # random; asked for everything, the filtering itself is what shows.
    titles = [t["title"] for t in recommend.similar("Bohemian Rhapsody", "Queen", limit=100)]
    assert "Bohemian Rhapsody" not in titles
    assert titles.count("Headlong") == 1
    # The tribute act's hit was skipped for the artist we were given.
    assert ("/artist/412/radio", {"limit": recommend.RADIO_SIZE}) in calls


def test_short_radio_is_topped_up_from_related_artists(api):
    responses, _, _ = api
    responses["/search/track"] = {"data": [_item(1, "Song", "Seed", 5)]}
    responses["/artist/5/radio"] = {"data": [_item(2, "Own", "Seed", 5)]}
    responses["/artist/5/related"] = {"data": [{"id": 6}, {"id": 7}]}
    responses["/artist/6/top"] = {"data": [_item(60, "Six A", "Six", 6), _item(61, "Six B", "Six", 6)]}
    responses["/artist/7/top"] = {"data": [_item(70, "Seven A", "Seven", 7), _item(71, "Seven B", "Seven", 7)]}
    got = {t["title"] for t in recommend.similar("Song", "Seed")}
    assert got == {"Own", "Six A", "Seven A", "Six B", "Seven B"}


def test_songs_already_on_disk_carry_their_file(api):
    responses, _, root = api
    _wav(root / "Queen - Headlong.wav", title="Headlong", artist="Queen")
    responses["/search/track"] = {"data": [_item(1, "x", "Queen", 412)]}
    responses["/artist/412/radio"] = {"data": [_item(2, "Headlong", "Queen", 412), _item(3, "Other", "Queen", 412)]}
    got = {t["title"]: t["file_id"] for t in recommend.similar("x", "Queen")}
    assert got["Headlong"] and got["Other"] is None


def test_endpoint(api):
    responses, _, _ = api
    client = TestClient(main.app)
    assert client.get("/api/recommend").status_code == 400
    # No artist to be found is a 400 the client can quietly ignore.
    assert client.get("/api/recommend", params={"title": "x", "artist": "y"}).status_code == 400
    responses["/search/track"] = {"data": [_item(1, "x", "y", 3)]}
    responses["/artist/3/radio"] = {"data": [_item(2, "z", "y", 3)]}
    res = client.get("/api/recommend", params={"title": "x", "artist": "y"})
    assert res.status_code == 200 and res.json()["tracks"][0]["title"] == "z"


def test_an_artist_with_no_radio_falls_back_to_their_top_tracks(api, monkeypatch):
    responses, _, _ = api
    responses["/search/track"] = {"data": [_item(1, "قلب من", "شادمهر عقیلی", 8)]}
    responses["/artist/8/top"] = {"data": [_item(2, "دلتنگی", "شادمهر عقیلی", 8)]}
    real = deezer._get

    def no_radio(path, **params):
        if path.endswith("/radio") or path.endswith("/related"):
            raise recommend.ProviderError("Deezer API error: no data")
        return real(path, **params)

    monkeypatch.setattr(deezer, "_get", no_radio)
    got = recommend.similar("قلب من", "شادمهر عقیلی")
    assert [t["title"] for t in got] == ["دلتنگی"]


def test_youtube_mix_fills_in_when_deezer_has_too_little(api, monkeypatch):
    from app.models import Track

    responses, _, _ = api
    mix = [
        Track(id=f"v{i}", title=f"Mix {i}", artists=["Shadmehr"], album="", duration_ms=1,
              cover_url=None, source_url=f"https://www.youtube.com/watch?v=v{i}")
        for i in range(3)
    ]
    monkeypatch.setattr(recommend, "_youtube_mix", lambda title, artist, limit: mix)
    got = recommend.similar("قلب من", "شادمهر عقیلی")
    assert {t["title"] for t in got} == {"Mix 0", "Mix 1", "Mix 2"}
    # Each comes with its upload, so it streams without another search.
    assert all(t["source_url"].startswith("https://www.youtube.com/") for t in got)

    monkeypatch.setenv("UNSTREAM_YOUTUBE_DISABLED", "true")
    with pytest.raises(recommend.ProviderError):
        recommend.similar("قلب من", "شادمهر عقیلی")
