"""Turn the rewriter's guesses at Instagram handles into accounts we are sure about.

Tagging the wrong account is worse than tagging none: a parody account, a stranger with the
same name, or a private profile that never wanted the attention. So every handle the model
offers is checked through Business Discovery - the legitimate way to ask Instagram about a
public professional account from one you own - and kept only when the account exists and its
name plausibly matches the entity the story named. Results are cached per handle so each is
looked up once a month, not once an article.
"""
from __future__ import annotations

import json
import logging
import re
import time

import requests

from ..state import State
from .instagram import GRAPH

log = logging.getLogger(__name__)

MAX_TAGS = 4                  # the source plus the two or three accounts the story is really about
CACHE_DAYS = 30
CACHE_SITE = "_instagram"     # site_notes rows under this key hold handle verdicts, shared by every site
HANDLE = re.compile(r"^[a-z0-9._]{1,30}$")


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _tokens(text: str) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(t) > 1}


def names_match(entity: str, account_name: str, username: str) -> bool:
    """Does this account plausibly belong to the entity the story named?

    Lenient enough for 'The Drum' -> @thedrum and 'Ogilvy India' -> 'Ogilvy', strict enough that
    'Zomato' never matches 'Zomato Fan Page' or an unrelated account that happens to share a word.
    """
    e, n, u = _squash(entity), _squash(account_name), _squash(username)
    if not e:
        return False
    # an account that says it is a fan page, parody or update feed is not the entity, however
    # closely its name echoes it - this has to be decided before any name similarity counts
    lowered = f"{account_name or ''} {username or ''}".lower()
    if any(w in lowered for w in ("fan", "parody", "unofficial", "memes", "updates")) and not any(
            w in entity.lower() for w in ("fan", "parody", "memes", "updates")):
        return False
    if e == n or e == u:
        return True
    # a handle may extend the name by a short suffix (zomato_in, ogilvyuk) or drop a qualifier the
    # story used (Ogilvy India -> ogilvy); it may not be a longer word that merely starts the same way
    if len(e) >= 4 and e in u and len(u) - len(e) <= 3:
        return True
    if len(u) >= 4 and u in e and len(e) - len(u) <= 8:
        return True
    et, nt = _tokens(entity), _tokens(account_name) | _tokens(username.replace(".", " ").replace("_", " "))
    if not et:
        return False
    return len(et & nt) / len(et) >= 0.6


def discover(anchor_uid: str, token: str, handle: str, timeout: int = 20) -> dict | None:
    """Business Discovery for one handle: the account's username and display name, or None."""
    fields = f"business_discovery.username({handle}){{username,name,followers_count}}"
    try:
        resp = requests.get(f"{GRAPH}/{anchor_uid}", params={"fields": fields, "access_token": token}, timeout=timeout)
        data = resp.json()
    except (requests.RequestException, ValueError) as exc:
        log.warning("[mentions] discovery for @%s failed: %s", handle, exc)
        return None
    if "error" in data:
        # the common answers: no such account, or a personal account Business Discovery cannot see
        log.info("[mentions] @%s not verifiable: %s", handle, str(data["error"].get("message", ""))[:120])
        return None
    return data.get("business_discovery")


def verify(candidates, anchor_uid: str, token: str, state: State | None = None, limit: int = MAX_TAGS) -> list[str]:
    """The handles worth tagging, in the order given, capped, each verified or cached as verified.

    `candidates` are the rewriter's Mention objects (name, kind, instagram). Publications come first
    because attribution is the tag that is always warranted; brands next; people last.
    """
    order = {"publication": 0, "brand": 1, "person": 2}
    ranked = sorted((c for c in candidates if getattr(c, "instagram", None)), key=lambda c: order.get(c.kind, 3))
    out: list[str] = []
    for cand in ranked:
        if len(out) >= limit:
            break
        handle = cand.instagram.strip().lstrip("@").lower()
        if not HANDLE.match(handle) or handle in out:
            continue
        verdict = None
        if state is not None:
            raw = state.note(CACHE_SITE, handle)
            if raw:
                try:
                    cached = json.loads(raw)
                    if time.time() - cached.get("at", 0) < CACHE_DAYS * 86400:
                        verdict = cached
                except ValueError:
                    verdict = None
        if verdict is None:
            found = discover(anchor_uid, token, handle)
            verdict = {"ok": bool(found), "name": (found or {}).get("name") or "", "at": time.time()}
            if state is not None:
                state.set_note(CACHE_SITE, handle, json.dumps(verdict))
        if not verdict["ok"]:
            continue
        if not names_match(cand.name, verdict["name"], handle):
            log.info("[mentions] @%s exists but is named %r, not %r; not tagging", handle, verdict["name"], cand.name)
            continue
        out.append(handle)
    return out


def tag_positions(n: int) -> list[tuple[float, float]]:
    """Where the photo tags sit: spread along the lower part of the card, clear of the footer."""
    if n <= 0:
        return []
    xs = [(i + 1) / (n + 1) for i in range(n)]
    return [(round(x, 3), 0.82) for x in xs]
