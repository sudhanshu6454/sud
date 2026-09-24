"""Follow-up posts: the pieces that go out a while after the article they belong to.

Three kinds today. `steal`: the 'Steal this' swipe-file card, one a day per site, lifted from the
first article after `steal_hour` that offered a reusable tactic. `debate`: the debate story, one a
day, from the first article after `debate_hour` that raised an arguable question. `hot_take`: the
throwback's bold line, posted as a quote card two hours after the feature.

Each is queued in `site_notes` as JSON when its article publishes and posted by a later cycle once
its time has come, so a day's posts spread out instead of stacking. A follow-up is tried once: if
the platforms refuse it, it is logged and dropped rather than retried into next week.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from slugify import slugify

from . import cards, images
from .cards import CardBrief
from .config import Settings, Site
from .social import SocialPost, dispatch
from .social.instagram import CTA
from .state import State

log = logging.getLogger(__name__)

NOTE = "followups"
STEAL_NOTE, DEBATE_NOTE = "steal", "debate"      # slot logs, same shape as the carousel one
FEED = ("instagram", "facebook")
STORY = ("instagram_story", "facebook_story")
KICKERS = {"steal": "Steal this", "hot_take": "Hot take"}


def load(state: State, site_key: str) -> list[dict]:
    try:
        items = json.loads(state.note(site_key, NOTE) or "[]")
    except json.JSONDecodeError:
        return []
    return [i for i in items if isinstance(i, dict) and "due" in i and "kind" in i]


def save(state: State, site_key: str, items: list[dict]) -> None:
    state.set_note(site_key, NOTE, json.dumps(items[-20:]))


def schedule(state: State, site_key: str, kind: str, due: float, payload: dict) -> None:
    items = load(state, site_key)
    items.append({"kind": kind, "due": due, **payload})
    save(state, site_key, items)
    log.info("[%s] %s follow-up queued for %s", site_key, kind, time.strftime("%H:%M", time.localtime(due)))


def split_due(items: list[dict], now: float) -> tuple[list[dict], list[dict]]:
    return [i for i in items if i["due"] <= now], [i for i in items if i["due"] > now]


def _caption(kind: str, item: dict, site: Site) -> dict[str, str]:
    if kind == "steal":
        text = f"Steal this: {item['idea']}\n\n{item['how']}\n\nSave this post for your next campaign."
        return {"instagram": text, "facebook": f"Steal this: {item['idea']}\n\n{item['how']}"}
    if kind == "hot_take":
        text = f"{item['take']}\n\nAgree or disagree? Tell us in the comments."
        return {"instagram": text, "facebook": text}
    return {"instagram": "", "facebook": ""}


def _brief(kind: str, item: dict, site: Site) -> CardBrief:
    if kind == "steal":
        return CardBrief("steal", item["idea"], KICKERS[kind], standfirst=item["how"])
    return CardBrief(cards.QUOTE, item.get("title", ""), KICKERS[kind], quote=item["take"],
                     quote_by=item.get("by") or f"{site.name} on {item.get('subject', 'this one')}")


def post_one(item: dict, site: Site, settings: Settings, state: State, wp, publishers, work_dir: Path) -> list:
    kind = item["kind"]
    stem = f"{slugify(item.get('title') or kind)[:40]}-{kind}"
    out = work_dir / site.slug
    if kind == "debate":
        frame = images.story_debate_frame(item["question"], item.get("options") or [], site, out / f"{stem}.jpg")
        media = wp.upload_media(frame, f"{item.get('title', 'Debate')} (debate story)", alt_text=item["question"])
        post = SocialPost(title=item.get("title", ""), link=item["link"], captions={},
                          image_urls={"story": media["source_url"]}, story_urls=[media["source_url"]],
                          alt_text=f"The debate: {item['question']}")
        targets = [p for p in publishers if p.platform in STORY]
    else:
        card = images.render_card(item.get("idea") or item.get("take", ""), KICKERS[kind], site, out / f"{stem}.jpg",
                                  "portrait", card=_brief(kind, item, site))
        asset = images.instagram_asset(card, ratio=settings.instagram_ratio, out_path=out / f"{stem}-ig.jpg")
        media = wp.upload_media(asset, f"{item.get('title', kind)} ({KICKERS[kind]})", alt_text=item.get("idea") or item.get("take"))
        post = SocialPost(title=item.get("title", ""), link=item["link"], captions=_caption(kind, item, site),
                          hashtags=site.hashtags, image_urls={"portrait": media["source_url"]},
                          alt_text=f"{KICKERS[kind]}: {item.get('idea') or item.get('take')}")
        targets = [p for p in publishers if p.platform in FEED]
    results = dispatch(targets, post)
    for res in results:
        state.record_social(item["link"], site.key, f"{res.platform}:{kind}", res.ok, res.remote_id, res.url, res.error)
    return results


def run(site: Site, settings: Settings, state: State, wp, publishers, work_dir: Path, report) -> int:
    """Post every follow-up whose time has come. Returns how many went out."""
    items = load(state, site.key)
    due, later = split_due(items, time.time())
    if not due:
        return 0
    save(state, site.key, later)     # taken off the queue first: a crash must not repost them next cycle
    posted = 0
    for item in due:
        try:
            results = post_one(item, site, settings, state, wp, publishers, work_dir)
        except Exception as exc:  # noqa: BLE001 - one follow-up must not stop the others
            log.warning("[%s] %s follow-up failed: %s", site.key, item["kind"], exc)
            report.social_failed += 1
            continue
        ok = sum(1 for r in results if r.ok)
        report.social_ok += ok
        report.social_failed += len(results) - ok
        posted += 1 if ok else 0
        log.info("[%s] %s follow-up posted to %s", site.key, item["kind"], ", ".join(r.platform for r in results if r.ok) or "nobody")
    return posted


__all__ = ["CTA", "schedule", "run", "load", "split_due", "post_one"]
