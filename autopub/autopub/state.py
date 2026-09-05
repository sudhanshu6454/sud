"""SQLite bookkeeping: which stories were used, what was published where."""
from __future__ import annotations

import hashlib
import sqlite3
import time
from pathlib import Path


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]


class State:
    def __init__(self, path: str | Path, dedupe_across_sites: bool = True):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.dedupe_across_sites = dedupe_across_sites
        self.conn = sqlite3.connect(str(self.path), isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def _migrate(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS articles (
                id TEXT PRIMARY KEY,           -- hash of (url) or (site|url)
                url TEXT NOT NULL,
                site TEXT NOT NULL,
                title TEXT,
                status TEXT NOT NULL,          -- claimed | published | failed | skipped
                wp_post_id INTEGER,
                wp_url TEXT,
                error TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_articles_site_status ON articles(site, status, updated_at);
            CREATE TABLE IF NOT EXISTS social_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id TEXT NOT NULL,
                site TEXT NOT NULL,
                platform TEXT NOT NULL,
                ok INTEGER NOT NULL,
                remote_id TEXT,
                remote_url TEXT,
                error TEXT,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_social_article ON social_posts(article_id);
            """
        )

    def _id(self, url: str, site: str) -> str:
        return url_hash(url if self.dedupe_across_sites else f"{site}|{url}")

    # -- articles ---------------------------------------------------------
    def claim(self, url: str, site: str, title: str = "") -> bool:
        """Atomically reserve a story for a site. Returns False if it was already used."""
        now = time.time()
        try:
            self.conn.execute(
                "INSERT INTO articles(id,url,site,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (self._id(url, site), url, site, title, "claimed", now, now),
            )
            return True
        except sqlite3.IntegrityError:
            return False

    def is_used(self, url: str, site: str) -> bool:
        row = self.conn.execute("SELECT 1 FROM articles WHERE id=?", (self._id(url, site),)).fetchone()
        return row is not None

    def _set_status(self, url: str, site: str, status: str, **fields) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        sql = f"UPDATE articles SET status=?, updated_at=?{', ' + cols if cols else ''} WHERE id=?"
        self.conn.execute(sql, (status, time.time(), *fields.values(), self._id(url, site)))

    def mark_published(self, url: str, site: str, wp_post_id: int, wp_url: str, title: str) -> None:
        self._set_status(url, site, "published", wp_post_id=wp_post_id, wp_url=wp_url, title=title, error=None)

    def mark_failed(self, url: str, site: str, error: str) -> None:
        self._set_status(url, site, "failed", error=error[:2000])

    def mark_skipped(self, url: str, site: str, reason: str) -> None:
        self._set_status(url, site, "skipped", error=reason[:500])

    def release(self, url: str, site: str) -> None:
        """Forget a claim so the story can be retried later (transient failure)."""
        self.conn.execute("DELETE FROM articles WHERE id=?", (self._id(url, site),))

    def last_published_at(self, site: str) -> float | None:
        row = self.conn.execute(
            "SELECT MAX(updated_at) AS t FROM articles WHERE site=? AND status='published'", (site,)
        ).fetchone()
        return row["t"] if row and row["t"] is not None else None

    def count(self, site: str | None = None, status: str = "published") -> int:
        if site:
            row = self.conn.execute("SELECT COUNT(*) c FROM articles WHERE site=? AND status=?", (site, status)).fetchone()
        else:
            row = self.conn.execute("SELECT COUNT(*) c FROM articles WHERE status=?", (status,)).fetchone()
        return int(row["c"])

    # -- social -----------------------------------------------------------
    def record_social(self, url: str, site: str, platform: str, ok: bool,
                      remote_id: str | None = None, remote_url: str | None = None, error: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO social_posts(article_id,site,platform,ok,remote_id,remote_url,error,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (self._id(url, site), site, platform, 1 if ok else 0, remote_id, remote_url, (error or "")[:2000] or None, time.time()),
        )

    def social_results(self, url: str, site: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM social_posts WHERE article_id=? ORDER BY id", (self._id(url, site),)
        ).fetchall()

    def recent(self, limit: int = 20) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT site,title,status,wp_url,error,updated_at FROM articles ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()

    def close(self) -> None:
        self.conn.close()
