"""The Autopub screen in each site's wp-admin: its overrides apply per cycle on top of sites.yaml."""
from autopub import control, pipeline
from autopub.state import State
from autopub.wordpress import WordPressError


class FakeWP:
    def __init__(self, overrides=None, fail=False):
        self.overrides, self.fail, self.checkins = overrides or {}, fail, []

    def plugin_request(self, method, route, **kw):
        if self.fail:
            raise WordPressError("GET autopub/v1/settings -> 404: rest_no_route")
        if method == "GET":
            return {"overrides": self.overrides}
        self.checkins.append(kw["json"])
        return {"ok": True}


def test_only_known_fields_of_the_right_type_are_applied():
    got = control.sanitize({
        "buzz_meter": False, "trailers": "yes", "max_posts_per_run": 5, "news_hours": [18, 9, 9, 13],
        "reddit_subreddits": ["movies", "bollywood"], "feeds": ["https://evil.example/feed"], "paused": 1,
    })
    assert got == {"buzz_meter": False, "max_posts_per_run": 5, "news_hours": [9, 13, 18],
                   "reddit_subreddits": ["movies", "bollywood"]}, "a string toggle, an int toggle and a field the screen does not own are dropped"
    assert control.sanitize({"max_posts_per_run": 999}) == {}
    assert control.sanitize({"reddit_subreddits": ["ok_name", "bad name!"]}) == {}
    assert control.sanitize({"news_hours": None}) == {"news_hours": None}, "null means every cycle"
    assert control.sanitize([]) == {}, "PHP's empty array arrives as a list"


def test_a_site_without_the_plugin_runs_on_sites_yaml(settings):
    site = settings.site("SCREENSTAT")
    assert control.apply(site, FakeWP(fail=True)) is site


def test_overrides_apply_to_a_copy_and_the_checkin_reports_both(settings):
    site = settings.site("SCREENSTAT")
    wp = FakeWP({"buzz_meter": False, "max_posts_per_run": 7})
    live = control.apply(site, wp)
    assert (live.buzz_meter, live.max_posts_per_run) == (False, 7)
    assert site.buzz_meter is True and site.max_posts_per_run == 3, "sites.yaml stays the baseline for the next cycle"
    [checkin] = wp.checkins
    assert checkin["baseline"]["buzz_meter"] is True and checkin["effective"]["buzz_meter"] is False
    assert set(checkin["baseline"]) == set(control.FIELDS)


def test_a_paused_site_is_skipped_and_the_rest_of_the_fleet_runs(monkeypatch, settings, tmp_path):
    ran = []
    monkeypatch.setattr(pipeline, "make_wordpress",
                        lambda site: FakeWP({"paused": True}) if site.key == "SCREENSTAT" else FakeWP(fail=True))
    monkeypatch.setattr(pipeline, "run_site", lambda site, settings, state, limit=None: ran.append(site.key) or pipeline.RunReport(site=site.key))
    pipeline.run_all(settings, State(tmp_path / "s.db"))
    assert "SCREENSTAT" not in ran and len(ran) == len(settings.sites) - 1


def test_no_wordpress_credentials_still_runs_the_site(monkeypatch, settings, tmp_path):
    ran = []
    monkeypatch.setattr(pipeline, "run_site", lambda site, settings, state, limit=None: ran.append(site) or pipeline.RunReport(site=site.key))
    pipeline.run_all(settings, State(tmp_path / "s.db"), only="SCREENSTAT")
    assert ran == [settings.site("SCREENSTAT")], "make_wordpress raises without WP_*_APP_PASSWORD; the site runs on sites.yaml"
