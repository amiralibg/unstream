"""Per-client limits for a public deployment.

No accounts, so the only handle on a caller is their IP. Counters are in
memory, per process — enough for the single-container stack this project ships
(docker-compose.yml); anything scaled out would need a shared store.

Two different things live here, and only one of them is about strangers:

* The **rate limiters** price what a caller can ask for per minute or hour.
  They exist because a public instance is an open relay without them, and
  they are noise on a machine whose only user is the person who installed it
  — so RATE_LIMITS_ENABLED=false switches them off in one move. The admin
  limiter is exempt: it charges *failed* token attempts, which is a
  brute-force guard, and a private instance that someone port-forwarded by
  accident needs it more than a public one, not less.

* The **job caps** below bound what one request can cost in threads and
  memory. Those are true of any deployment, so they stay on when the rate
  limiters are off, and are widened rather than disabled — 0 for no limit.

Messages stay English at the wire; the Farsi UI translates at the API seam
(`localizeError` in frontend/src/lib/api.ts).
"""

import ipaddress
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from . import analytics

def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


# Whether a caller is charged for what they ask for at all. Leave it on for
# anything reachable by someone you don't know.
RATE_LIMITS_ENABLED = _flag("RATE_LIMITS_ENABLED", True)

# Search fans out to four providers for up to 20s — by far the most expensive
# read. Resolve is a single fetch, so it can be looser.
SEARCH_PER_MINUTE = int(os.getenv("RATE_SEARCH_PER_MINUTE", "15"))
RESOLVE_PER_MINUTE = int(os.getenv("RATE_RESOLVE_PER_MINUTE", "30"))
DOWNLOADS_PER_HOUR = int(os.getenv("RATE_DOWNLOADS_PER_HOUR", "20"))

# Serving a finished file costs no CPU but all of the bandwidth, and a job id
# is the only thing needed to ask for one. Generous enough that tapping save
# on every row of a long album never trips it, tight enough that a loop does.
FILES_PER_MINUTE = int(os.getenv("RATE_FILES_PER_MINUTE", "60"))
# A ZIP is the whole album in one request, so it is priced per hour instead.
ZIPS_PER_HOUR = int(os.getenv("RATE_ZIPS_PER_HOUR", "30"))

# One active job per caller would 429 the second song someone taps, because
# the UI puts a download button on every row. Three matches the download
# pool's default worker count in jobs.py.
#
# 0 means no limit on either, which is a real thing to want — a discography
# is one job of several hundred tracks — and not something the rate limiters'
# off switch should imply, since these cost threads and memory rather than
# somebody else's fair share.
MAX_ACTIVE_JOBS = int(os.getenv("MAX_ACTIVE_JOBS_PER_CLIENT", "3"))
# A Spotify playlist resolves in full now, so the per-job ceiling has to sit
# above the embed's 100-row cap or "download all" on a long playlist would
# resolve everything and then refuse to download it. Downloads still run on a
# few threads and a playlist of this size is a bounded, visible unit of work.
MAX_TRACKS_PER_JOB = int(os.getenv("MAX_TRACKS_PER_JOB", "500"))
# How many job ids one poll may ask about. This bounds the response, not the
# caller's fair share — but a client with more jobs than the cap silently
# stops hearing about the overflow, which on a desktop queuing a discography
# is a stuck progress bar. 0 means no limit, same as the two above.
MAX_POLL_IDS = int(os.getenv("MAX_POLL_IDS", "50"))


def client_ip(request: Request) -> str:
    """Best guess at the real caller behind the proxy chain.

    Each hop *appends* to X-Forwarded-For, so the header reads
    `[spoofed…, ] client, traefik`. Walking right-to-left to the first public
    address skips anything the caller injected: a spoofed entry can only sit to
    the left of an address a proxy actually observed.
    """
    peer = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded or not _is_internal(peer):
        # Direct connection — the socket address is all there is to trust.
        return peer

    hops = [h.strip() for h in forwarded.split(",") if h.strip()]
    for hop in reversed(hops):
        if not _is_internal(hop):
            return hop
    return hops[0] if hops else peer


def _is_internal(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return False  # not an IP at all — treat as untrusted


def visitor(request: Request) -> str:
    """Analytics pseudonym for the caller — hashed, daily, never stored raw."""
    return analytics.visitor_id(client_ip(request), request.headers.get("user-agent", ""))


class RateLimiter:
    """Sliding-window counter: at most `limit` hits per `window` seconds."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def take(self, key: str) -> float | None:
        """Record a hit. Returns seconds to wait if the caller is over."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(1.0, round(self.window - (now - hits[0]), 1))
            hits.append(now)
            # Or a long-lived process accumulates every IP it has ever seen.
            if len(self._hits) > 4096:
                self._prune(now)
            return None

    def _prune(self, now: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
            del self._hits[key]


_SEARCH = RateLimiter(SEARCH_PER_MINUTE, 60)
_RESOLVE = RateLimiter(RESOLVE_PER_MINUTE, 60)
_DOWNLOAD = RateLimiter(DOWNLOADS_PER_HOUR, 3600)
_FILE = RateLimiter(FILES_PER_MINUTE, 60)
_ZIP = RateLimiter(ZIPS_PER_HOUR, 3600)
# Analytics beacons: a real browser sends a handful per session, so this is
# only here to stop someone inflating the numbers with a loop.
_COLLECT = RateLimiter(int(os.getenv("RATE_COLLECT_PER_MINUTE", "30")), 60)
# Lyric lookups are cheap (they hit LRCLIB, not YouTube), but each one can
# fan out to two requests, so they still get a budget.
_LYRICS = RateLimiter(int(os.getenv("RATE_LYRICS_PER_MINUTE", "30")), 60)
# Charged on *failed* admin auth only, so a wrong token a few times is fine
# but guessing at the token is not.
_ADMIN = RateLimiter(10, 900)

_LIMITERS = {
    "search": _SEARCH,
    "resolve": _RESOLVE,
    "download": _DOWNLOAD,
    "file": _FILE,
    "zip": _ZIP,
    "collect": _COLLECT,
    "lyrics": _LYRICS,
    "admin": _ADMIN,
}

_MESSAGES = {
    "search": "Too many searches — wait {retry}s and try again.",
    "resolve": "Too many links opened — wait {retry}s and try again.",
    "download": "Too many downloads started — wait {retry}s and try again.",
    "file": "Too many files saved — wait {retry}s and try again.",
    "zip": "Too many ZIPs — wait {retry}s and try again.",
    "collect": "Too many events — wait {retry}s and try again.",
    "lyrics": "Too many lyric lookups — wait {retry}s and try again.",
    "admin": "Too many bad tokens — wait {retry}s and try again.",
}

# The point of a `rate_limited` event is seeing real people bump into a
# limit. Beacon spam and token guessing would only flood the table.
_TRACKED = {"search", "resolve", "download", "file", "zip"}

# Charged even with RATE_LIMITS_ENABLED off. "admin" is not a fair-share
# budget — it only counts *wrong* tokens, so the sole way to feel it is to be
# guessing at one, and turning that off to make a private instance more
# convenient would trade the only thing standing in front of the dashboard
# for nothing anyone would notice.
_ALWAYS_ENFORCED = {"admin"}


def enforce(kind: str, request: Request) -> str:
    """Charge one hit against the caller's budget, or raise 429.

    Returns the client key, which callers reuse for per-client job limits.
    """
    key = client_ip(request)
    if not RATE_LIMITS_ENABLED and kind not in _ALWAYS_ENFORCED:
        return key
    retry = _LIMITERS[kind].take(key)
    if retry is not None:
        if kind in _TRACKED:
            analytics.record(
                "rate_limited",
                visitor=visitor(request),
                detail=kind,
            )
        raise HTTPException(
            status_code=429,
            detail=_MESSAGES[kind].format(retry=int(retry)),
            headers={"Retry-After": str(int(retry))},
        )
    return key
