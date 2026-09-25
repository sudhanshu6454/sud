"""Load sites.yaml + environment into typed settings."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_CONFIG = Path(os.environ.get("AUTOPUB_CONFIG", "/app/config/sites.yaml"))
DEFAULT_DATA_DIR = Path(os.environ.get("AUTOPUB_DATA_DIR", "/data"))


@dataclass
class Brand:
    primary: str = "#0f172a"
    accent: str = "#f97316"
    text: str = "#ffffff"
    logo: str | None = None  # path to a PNG wordmark, resolved relative to sites.yaml at load time
    font: str | None = None  # typeface for the share cards: a file stem in autopub/fonts (e.g. "Inter")
    heading_weight: int = 700   # the weight that site's own headings use, so the cards match it
    rail: str = "solid"         # the card's section rule: solid | double | inset | bars


@dataclass
class Site:
    key: str
    domain: str
    name: str
    tagline: str = ""
    niche: str = ""
    audience: str = ""
    tone: str = ""
    category: str = "News"
    categories: list[str] = field(default_factory=list)   # if set, Claude files each article under one of these
    use_source_image: bool = True                          # share image backdrop: real source photo vs. flat gradient
    max_posts_per_run: int = 2
    max_age_hours: int = 48
    min_words: int = 250
    include_keywords: list[str] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)
    feeds: list[str] = field(default_factory=list)
    google_news_queries: list[str] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    brand: Brand = field(default_factory=Brand)
    socials: list[str] = field(default_factory=list)
    nostalgia: bool = False     # one classic-ad throwback feature a day, at settings.nostalgia_hour
    scorecards: bool = False    # actor scorecards from Wikipedia figures, at each settings.scorecard_hours

    @property
    def public_url(self) -> str:
        return f"https://{self.domain}"

    @property
    def slug(self) -> str:
        return self.key.lower()

    def env(self, prefix: str, name: str, default: str | None = None) -> str | None:
        """Read a per-site variable, e.g. env("WP", "APP_PASSWORD") -> WP_<KEY>_APP_PASSWORD."""
        return os.environ.get(f"{prefix}_{self.key}_{name}", default)

    def wp_base_url(self) -> str:
        """Where autopub talks to WordPress.

        Inside docker-compose we go straight to the site's container (hairpin NAT through
        the public IP is unreliable); elsewhere we use the public HTTPS URL.
        """
        override = self.env("WP", "URL")
        if override:
            return override.rstrip("/")
        if os.environ.get("AUTOPUB_WP_INTERNAL", "").lower() in ("1", "true", "yes"):
            return f"http://wp_{self.slug}"
        return self.public_url


@dataclass
class Settings:
    sites: list[Site]
    interval_minutes: int = 120
    dedupe_across_sites: bool = True
    request_timeout: int = 30
    llm_model: str = "claude-opus-5"
    llm_effort: str = "medium"
    min_gap_minutes_between_posts: int = 20
    # Candidate headlines are scored 0-10 against the site's beat before anything is written
    # (autopub/rank.py). 0 disables it and restores plain newest-first selection.
    min_relevance: int = 5
    rank_pool: int = 40
    # Instagram's API documents a 4:5 floor for feed images and hard-refuses anything taller
    # (error 36003/2207009). The cards are drawn 3:4; this says which shape actually gets posted.
    # Flip to "3:4" once `python -m autopub instagram-probe` shows Meta accepting 0.75.
    instagram_ratio: str = "4:5"
    # Twice a day the Instagram post is a carousel instead of a single card: the first article a site
    # publishes at or after each of these hours, in `timezone`. [] switches carousels off.
    carousel_hours: list[int] = field(default_factory=lambda: [9, 18])
    # Likewise for video: the first article at or after each of these hours also goes out as a reel
    # (Instagram) and a video post (Facebook Page), built from its story frames. [] switches it off.
    reel_hours: list[int] = field(default_factory=lambda: [12, 21])
    reel_share_to_feed: bool = True     # show reels in the profile grid too, not only in the Reels tab
    # The reel's narration: a Piper voice name (rhasspy/piper-voices), fetched once into <data_dir>/voices.
    # "" posts silent reels.
    reel_voice: str = "af_heart"      # local, no key; cloud Indian English voices are azure:... / google:...
    # A music bed under the reel, matched to the story's mood: your own licensed tracks from
    # <data_dir>/music/<mood>/ when present, else one composed on the spot. False = voice only.
    reel_music: bool = True
    # The daily throwback: one iconic ad campaign, revisited, on sites with `nostalgia: true`. The first
    # cycle at or after this hour (in `timezone`) publishes it. None switches it off.
    nostalgia_hour: int | None = 15
    # One 'Steal this' card a day (the first article at or after this hour that offers a reusable tactic)
    # and one debate story a day (the first that raises an arguable question), each posted as a follow-up
    # `followup_delay_minutes` after the article. The throwback's hot take follows the same way. None = off.
    # Actor scorecards (sites with scorecards: true): the first cycle at or after each of these hours
    # publishes one actor's career in numbers, figures from Wikipedia. [] switches them off.
    scorecard_hours: list[int] = field(default_factory=lambda: [8, 11, 14, 17, 20])
    # Instagram allows 100 API publishes per account a day and every story frame counts as one, so a
    # story sequence goes out for every Nth news article (1 = every article). Throwbacks and
    # scorecards always get theirs.
    story_every: int = 2
    steal_hour: int | None = 11
    debate_hour: int | None = 17
    followup_delay_minutes: int = 120
    timezone: str = "Asia/Kolkata"
    data_dir: Path = DEFAULT_DATA_DIR

    def site(self, key: str) -> Site:
        for s in self.sites:
            if s.key.upper() == key.upper():
                return s
        raise KeyError(f"unknown site key {key!r}; known: {[s.key for s in self.sites]}")


def _site_from_dict(raw: dict, config_dir: Path) -> Site:
    data = dict(raw)
    brand = data.pop("brand", None) or {}
    site = Site(brand=Brand(**brand), **data)
    site.key = site.key.upper()
    site.niche = " ".join(site.niche.split())
    if site.brand.logo:
        logo_path = (config_dir / site.brand.logo).resolve()
        site.brand.logo = str(logo_path) if logo_path.exists() else None
    if not site.categories:
        site.categories = [site.category]
    return site


def load(path: str | os.PathLike | None = None) -> Settings:
    cfg_path = Path(path) if path else DEFAULT_CONFIG
    with open(cfg_path, "r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}
    settings_raw = dict(raw.get("settings") or {})
    sites = [_site_from_dict(s, cfg_path.parent) for s in raw.get("sites") or []]
    if not sites:
        raise ValueError(f"no sites defined in {cfg_path}")
    keys = [s.key for s in sites]
    if len(set(keys)) != len(keys):
        raise ValueError(f"duplicate site keys in {cfg_path}: {keys}")
    data_dir = Path(os.environ.get("AUTOPUB_DATA_DIR", settings_raw.pop("data_dir", DEFAULT_DATA_DIR)))
    settings = Settings(sites=sites, data_dir=data_dir, **settings_raw)
    settings.carousel_hours = sorted({int(h) % 24 for h in (settings.carousel_hours or [])})
    settings.reel_hours = sorted({int(h) % 24 for h in (settings.reel_hours or [])})
    settings.scorecard_hours = sorted({int(h) % 24 for h in (settings.scorecard_hours or [])})
    return settings
