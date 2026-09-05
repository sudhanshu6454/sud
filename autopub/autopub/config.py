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
    return Settings(sites=sites, data_dir=data_dir, **settings_raw)
