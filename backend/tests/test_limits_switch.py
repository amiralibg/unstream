"""Turning the rate limiters off, and what stays on when you do.

A public instance without these is an open relay. A laptop with them is just
annoying. The switch exists for the second case — but "off" has to mean off
for fair-share budgets only, because the admin limiter is not one: it charges
wrong tokens, so the only caller who ever feels it is one guessing at the
dashboard password.
"""

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import limits


@pytest.fixture(autouse=True)
def no_analytics(monkeypatch):
    """Charging a limit records an event; the tests are not about the DB."""
    monkeypatch.setattr(limits.analytics, "record", lambda *a, **k: None)
    monkeypatch.setattr(limits.analytics, "visitor_id", lambda *a, **k: "test")


def make_request(client: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/search",
            "client": (client, 51234),
            "headers": [],
        }
    )


def spend(kind: str, client: str, times: int) -> None:
    for _ in range(times):
        limits.enforce(kind, make_request(client))


def test_limits_on_eventually_refuses(monkeypatch):
    monkeypatch.setattr(limits, "RATE_LIMITS_ENABLED", True)

    with pytest.raises(HTTPException) as caught:
        spend("search", "203.0.113.10", limits.SEARCH_PER_MINUTE + 1)

    assert caught.value.status_code == 429


def test_limits_off_never_refuses(monkeypatch):
    monkeypatch.setattr(limits, "RATE_LIMITS_ENABLED", False)

    # Far past every budget in the file, including the hourly ones.
    for kind in ("search", "resolve", "download", "file", "zip", "jobs", "collect"):
        spend(kind, "203.0.113.11", 1000)


def test_limits_off_still_returns_the_client_key(monkeypatch):
    """The download endpoint reuses this key to count a caller's jobs, so the
    short-circuit has to keep identifying people, not just stop charging."""
    monkeypatch.setattr(limits, "RATE_LIMITS_ENABLED", False)

    assert limits.enforce("search", make_request("203.0.113.12")) == "203.0.113.12"


def test_bad_admin_tokens_are_charged_even_with_limits_off(monkeypatch):
    monkeypatch.setattr(limits, "RATE_LIMITS_ENABLED", False)

    with pytest.raises(HTTPException) as caught:
        spend("admin", "203.0.113.13", 11)  # the admin limiter allows 10

    assert caught.value.status_code == 429


@pytest.mark.parametrize(
    "value, expected",
    [
        ("false", False),
        ("FALSE", False),
        ("0", False),
        ("no", False),
        ("off", False),
        (" off ", False),
        ("true", True),
        ("1", True),
        ("", True),  # an empty variable is not a decision to turn it off
        (None, True),  # unset
    ],
)
def test_flag_parsing(monkeypatch, value, expected):
    monkeypatch.delenv("UNSTREAM_TEST_FLAG", raising=False)
    if value is not None:
        monkeypatch.setenv("UNSTREAM_TEST_FLAG", value)

    assert limits._flag("UNSTREAM_TEST_FLAG", True) is expected
