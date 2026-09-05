import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from autopub import config  # noqa: E402


@pytest.fixture
def settings(tmp_path):
    s = config.load(ROOT / "config" / "sites.yaml")
    s.data_dir = tmp_path / "data"
    s.min_gap_minutes_between_posts = 0
    return s


@pytest.fixture
def site(settings):
    return settings.sites[0]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in list(os.environ):
        if k.startswith(("TWITTER_", "FACEBOOK_", "INSTAGRAM_", "LINKEDIN_", "PINTEREST_", "TELEGRAM_", "THREADS_", "WP_", "AUTOPUB_WP_INTERNAL")):
            monkeypatch.delenv(k, raising=False)
