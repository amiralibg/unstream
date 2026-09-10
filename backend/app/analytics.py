"""Self-hosted usage analytics — no third party, no cookies, no raw IPs.

Every interesting thing that happens becomes one row in a SQLite table.
Most events are recorded server-side inside the endpoints that already
exist, so an ad blocker can't hide them and the page pays nothing to be
for free; only page views need the browser to say anything (see
`/api/collect` in main.py).

Writes go through a queue drained by one background thread. Nothing on a
request path or a download worker ever touches the disk, and a full queue
drops events rather than slowing anything down — analytics must never be
able to break a download.

A caller is identified by `visitor_id()`: a hash of IP + user agent + the
day, salted with a secret generated once per install. It gives daily
unique counts without storing an address or setting a cookie. The cost is
deliberate: because the hash rotates at midnight, nobody can be followed
from one day to the next, so there is no "returning visitor" metric.
"""

import hashlib
import os
import queue
import secrets
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(
    os.getenv("ANALYTICS_DB_PATH", Path(__file__).resolve().parent.parent / "data" / "analytics.db")
)
RETENTION_DAYS = int(os.getenv("ANALYTICS_RETENTION_DAYS", "90"))

# Which day a timestamp belongs to. Days are UTC unless this is set — put
# your own offset here (Tehran is 210) so the dashboard's "today" is your
# today and not a bar that resets mid-afternoon.
UTC_OFFSET_MINUTES = int(os.getenv("ANALYTICS_UTC_OFFSET_MINUTES", "0"))

# Full enough to survive a burst, small enough that a stuck writer costs
# memory in kilobytes rather than megabytes.
_QUEUE_MAX = 4096
_BATCH_MAX = 200
_SWEEP_INTERVAL_SECONDS = 3600

# Longest human string kept in `label` — enough for "Artist - Title",
# short enough that nobody can grow the file by pasting an essay.
_LABEL_MAX = 160

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY,
    ts      INTEGER NOT NULL,   -- unix seconds
    day     TEXT    NOT NULL,   -- YYYY-MM-DD, already offset — group by this
    name    TEXT    NOT NULL,   -- search | resolve | download_start | ...
    surface TEXT    NOT NULL,   -- web | pwa
    visitor TEXT,               -- daily-rotating hash; NULL server-side
    source  TEXT,               -- provider, audio host, referrer host
    detail  TEXT,               -- low-cardinality: quality, device, error class
    label   TEXT,               -- high-cardinality: query, track name, path
    value   INTEGER,            -- count that belongs to the event
    ms      INTEGER             -- how long it took, where that means anything
);
CREATE INDEX IF NOT EXISTS events_day_name ON events (day, name);
CREATE INDEX IF NOT EXISTS events_name_day ON events (name, day);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

_queue: "queue.Queue[tuple] | None" = None
_salt = ""
_lock = threading.Lock()


# --------------------------------------------------------------------------
# lifecycle


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    # WAL lets the dashboard read while the writer thread is mid-batch.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def start() -> None:
    """Open the database and start the writer. Safe to call twice."""
    global _queue, _salt
    with _lock:
        if _queue is not None:
            return
        try:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            conn = _connect()
            conn.executescript(_SCHEMA)
            _salt = _load_salt(conn)
            conn.close()
        except Exception:
            # An unwritable volume must not stop the app from serving music.
            return
        _queue = queue.Queue(maxsize=_QUEUE_MAX)
        threading.Thread(target=_writer_loop, name="analytics-writer", daemon=True).start()


def enabled() -> bool:
    return _queue is not None


def _load_salt(conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT value FROM meta WHERE key = 'salt'").fetchone()
    if row:
        return row[0]
    salt = secrets.token_hex(16)
    conn.execute("INSERT INTO meta (key, value) VALUES ('salt', ?)", (salt,))
    conn.commit()
    return salt


def _writer_loop() -> None:
    conn = _connect()
    next_sweep = time.monotonic() + _SWEEP_INTERVAL_SECONDS
    while True:
        try:
            batch = [_queue.get()]  # block until there is something to do
            while len(batch) < _BATCH_MAX:
                try:
                    batch.append(_queue.get_nowait())
                except queue.Empty:
                    break
            conn.executemany(
                "INSERT INTO events (ts, day, name, surface, visitor, source,"
                " detail, label, value, ms) VALUES (?,?,?,?,?,?,?,?,?,?)",
                batch,
            )
            conn.commit()
            if time.monotonic() >= next_sweep:
                _sweep(conn)
                next_sweep = time.monotonic() + _SWEEP_INTERVAL_SECONDS
        except Exception:
            # Losing a batch is acceptable; losing the writer is not.
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(5)
            try:
                conn = _connect()
            except Exception:
                pass


def _sweep(conn: sqlite3.Connection) -> None:
    cutoff = day_of(time.time() - RETENTION_DAYS * 86400)
    conn.execute("DELETE FROM events WHERE day < ?", (cutoff,))
    conn.commit()


# --------------------------------------------------------------------------
# writing


def day_of(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts + UTC_OFFSET_MINUTES * 60))


def record(
    name: str,
    *,
    surface: str = "web",
    visitor: str | None = None,
    source: str | None = None,
    detail: str | None = None,
    label: str | None = None,
    value: int | None = None,
    ms: int | None = None,
) -> None:
    """Queue one event. Never raises, never blocks."""
    if _queue is None:
        return
    now = time.time()
    row = (
        int(now),
        day_of(now),
        name,
        surface,
        visitor,
        source,
        detail,
        label[:_LABEL_MAX].strip() if label else None,
        value,
        ms,
    )
    try:
        _queue.put_nowait(row)
    except queue.Full:
        pass


def visitor_id(ip: str, user_agent: str, ts: float | None = None) -> str:
    """Stable-for-one-day pseudonym for a caller. Not reversible to an IP."""
    if not _salt:
        return ""
    material = f"{_salt}|{ip}|{user_agent}|{day_of(ts if ts is not None else time.time())}"
    return hashlib.sha256(material.encode()).hexdigest()[:16]


def error_class(message: str) -> str:
    """Bucket a download failure into something countable.

    Raw messages carry video ids and file paths, so a thousand failures
    would be a thousand distinct strings and the top-errors list would say
    nothing. These buckets are what actually differs between them.
    """
    text = message.lower()
    for needle, bucket in (
        ("sign in to confirm", "youtube bot check"),
        ("the page needs to be reloaded", "youtube bot check"),
        ("age", "age restricted"),
        ("private", "private or removed"),
        ("unavailable", "private or removed"),
        ("no candidate", "no matching audio found"),
        ("no suitable", "no matching audio found"),
        ("ffmpeg", "encoding failed"),
        ("timed out", "timeout"),
        ("timeout", "timeout"),
        ("connection", "network"),
        ("http error 4", "blocked by source"),
        ("http error 5", "source server error"),
    ):
        if needle in text:
            return bucket
    return "other"


# --------------------------------------------------------------------------
# reading


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()


def _breakdown(
    conn: sqlite3.Connection, since: str, column: str, where: str, params: tuple = (), limit: int = 12
) -> list[dict]:
    sql = (
        f"SELECT {column} AS key, COUNT(*) AS count FROM events"
        f" WHERE day >= ? AND {where} AND {column} IS NOT NULL AND {column} != ''"
        f" GROUP BY {column} ORDER BY count DESC LIMIT {limit}"
    )
    return [{"key": r[0], "count": r[1]} for r in _rows(conn, sql, (since, *params))]


def _median_ms(conn: sqlite3.Connection, since: str) -> int | None:
    where = "name = 'track_done' AND day >= ? AND ms IS NOT NULL"
    total = conn.execute(f"SELECT COUNT(*) FROM events WHERE {where}", (since,)).fetchone()[0]
    if not total:
        return None
    row = conn.execute(
        f"SELECT ms FROM events WHERE {where} ORDER BY ms LIMIT 1 OFFSET ?",
        (since, total // 2),
    ).fetchone()
    return row[0] if row else None


def _day_span(days: int) -> list[str]:
    now = time.time()
    return [day_of(now - i * 86400) for i in range(days - 1, -1, -1)]


def stats(days: int = 30) -> dict:
    """Everything the dashboard shows, in one query round."""
    if not enabled():
        return {"enabled": False}

    span = _day_span(days)
    since = span[0]
    conn = _connect()
    try:
        # One pass for the daily series — counts per (day, event).
        per_day: dict[str, dict[str, int]] = {d: {} for d in span}
        for day, name, count in _rows(
            conn,
            "SELECT day, name, COUNT(*) FROM events WHERE day >= ? GROUP BY day, name",
            (since,),
        ):
            per_day.setdefault(day, {})[name] = count

        for day, uniques in _rows(
            conn,
            "SELECT day, COUNT(DISTINCT visitor) FROM events"
            " WHERE day >= ? AND visitor IS NOT NULL GROUP BY day",
            (since,),
        ):
            per_day.setdefault(day, {})["visitors"] = uniques

        series = [
            {
                "day": day,
                "page_views": per_day.get(day, {}).get("page_view", 0),
                "visitors": per_day.get(day, {}).get("visitors", 0),
                "searches": per_day.get(day, {}).get("search", 0),
                "downloads": per_day.get(day, {}).get("download_start", 0),
                "tracks_done": per_day.get(day, {}).get("track_done", 0),
                "tracks_failed": per_day.get(day, {}).get("track_error", 0),
            }
            for day in span
        ]

        totals = {key: sum(row[key] for row in series) for key in series[0] if key != "day"}
        totals["visitors"] = conn.execute(
            "SELECT COUNT(DISTINCT visitor) FROM events WHERE day >= ? AND visitor IS NOT NULL",
            (since,),
        ).fetchone()[0]

        # One pass for every plain event count, rather than a query each.
        counts = {
            name: total
            for name, total in _rows(
                conn,
                "SELECT name, COUNT(*) FROM events WHERE day >= ? GROUP BY name",
                (since,),
            )
        }
        totals["zips"] = counts.get("zip_download", 0)
        totals["rate_limited"] = counts.get("rate_limited", 0)
        # A file leaving the server is the only event that means what a user
        # means by "a download" — everything before it is a queue.
        totals["files_saved"] = counts.get("file_save", 0)
        totals["artist_views"] = counts.get("artist_view", 0)
        totals["link_errors"] = counts.get("resolve_error", 0)
        totals["installs"] = counts.get("pwa_install", 0)
        # The gap between the two is the interesting part: how many people the
        # browser offered an install to, and how many took it.
        totals["install_prompts"] = counts.get("install_prompt", 0)
        totals["shares"] = conn.execute(
            "SELECT COUNT(*) FROM events WHERE day >= ? AND name = 'share' AND detail = 'shared'",
            (since,),
        ).fetchone()[0]
        totals["tracks_delivered"] = conn.execute(
            "SELECT COALESCE(SUM(value), 0) FROM events WHERE day >= ? AND name = 'download_start'",
            (since,),
        ).fetchone()[0]
        attempted = totals["tracks_done"] + totals["tracks_failed"]
        totals["success_rate"] = round(totals["tracks_done"] / attempted, 4) if attempted else None
        median = _median_ms(conn, since)
        totals["median_track_seconds"] = round(median / 1000, 1) if median else None

        # "Artist - Title" is the label on every finished track, so the lead
        # artist is everything before the first separator.
        top_artists = [
            {"key": r[0], "count": r[1]}
            for r in _rows(
                conn,
                "SELECT substr(label, 1, instr(label, ' - ') - 1) AS artist, COUNT(*) AS count"
                " FROM events WHERE day >= ? AND name = 'track_done' AND instr(label, ' - ') > 1"
                " GROUP BY artist ORDER BY count DESC LIMIT 12",
                (since,),
            )
        ]

        breakdowns = {
            "top_searches": _breakdown(conn, since, "label", "name = 'search'", limit=20),
            "top_tracks": _breakdown(conn, since, "label", "name = 'track_done'", limit=20),
            "top_artists": top_artists,
            "quality": _breakdown(conn, since, "detail", "name = 'download_start'"),
            "link_providers": _breakdown(conn, since, "source", "name = 'resolve'"),
            "audio_sources": _breakdown(conn, since, "source", "name = 'track_done'"),
            "errors": _breakdown(conn, since, "detail", "name = 'track_error'"),
            "referrers": _breakdown(conn, since, "source", "name = 'page_view'"),
            "devices": _breakdown(conn, since, "detail", "name = 'page_view'"),
            "surfaces": _breakdown(conn, since, "surface", "name != 'page_view'"),
            "limits_hit": _breakdown(conn, since, "detail", "name = 'rate_limited'"),
            # Which provider a pasted link failed on. The embed pages are an
            # undocumented structure, so this is where a Spotify change shows
            # up first — as one source climbing on its own.
            "link_errors": _breakdown(conn, since, "source", "name = 'resolve_error'"),
            "artists_browsed": _breakdown(conn, since, "label", "name = 'artist_view'"),
        }

        # Nobody searching means nobody finding — worth seeing on its own.
        empty = conn.execute(
            "SELECT COUNT(*) FROM events WHERE day >= ? AND name = 'search' AND detail = 'empty'",
            (since,),
        ).fetchone()[0]
        totals["empty_searches"] = empty

        return {
            "enabled": True,
            "days": days,
            "from": since,
            "to": span[-1],
            "totals": totals,
            "series": series,
            "breakdowns": breakdowns,
        }
    finally:
        conn.close()


def recent(limit: int = 200) -> list[dict]:
    """Raw event feed, newest first — for checking the wiring works."""
    if not enabled():
        return []
    conn = _connect()
    try:
        rows = _rows(
            conn,
            "SELECT ts, name, surface, visitor, source, detail, label, value, ms"
            " FROM events ORDER BY id DESC LIMIT ?",
            (min(limit, 1000),),
        )
    finally:
        conn.close()
    keys = ("ts", "name", "surface", "visitor", "source", "detail", "label", "value", "ms")
    return [dict(zip(keys, row)) for row in rows]
