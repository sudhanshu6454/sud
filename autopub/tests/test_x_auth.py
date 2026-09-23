"""infra/x-auth.py: PIN-based OAuth 1.0a for the brands' X accounts, refusing a wrong login."""
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "infra" / "x-auth.py"


@pytest.fixture
def xa():
    spec = importlib.util.spec_from_file_location("x_auth", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _values(p: Path) -> dict:
    return dict(l.split("=", 1) for l in p.read_text().splitlines() if "=" in l)


def test_signature_matches_the_documented_oauth_example(xa):
    """The worked example from X's own 'Creating a signature' documentation."""
    params = {
        "include_entities": "true",
        "oauth_consumer_key": "xvz1evFS4wEEPTGEFPHBog",
        "oauth_nonce": "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": "1318622958",
        "oauth_token": "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        "oauth_version": "1.0",
        "status": "Hello Ladies + Gentlemen, a signed OAuth request!",
    }
    sig = xa.sign("POST", "https://api.twitter.com/1.1/statuses/update.json", params,
                  "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw", "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE")
    assert sig == "hCtSmYh+iHYCEqBWrE7C7hYmtUk="


def _fake_x(accounts: dict):
    """Stand in for X: request tokens, then access tokens whose screen_name depends on the PIN."""
    calls = []

    def http_post(url, header):
        calls.append((url, header))
        if url.endswith("request_token"):
            assert 'oauth_callback="oob"' in header
            return {"oauth_token": "REQ", "oauth_token_secret": "REQSECRET", "oauth_callback_confirmed": "true"}
        pin = header.split('oauth_verifier="')[1].split('"')[0]
        who = accounts[pin]
        return {"oauth_token": f"{who['id']}-ACCESS", "oauth_token_secret": f"SECRET-{who['id']}", "screen_name": who["handle"], "user_id": who["id"]}

    return http_post, calls


def test_each_site_is_wired_only_when_the_login_is_the_brand_named(xa, tmp_path, monkeypatch, capsys):
    env = tmp_path / ".env"; env.write_text("WP_URL=x\nX_API_KEY=key\nX_API_SECRET=sec\n")
    http_post, calls = _fake_x({"1111": {"id": "41", "handle": "crazy4marketingg"}, "2222": {"id": "42", "handle": "sudhanshu_personal"}})
    monkeypatch.setattr(xa, "http_post", http_post)
    pins = iter(["1111", "2222"])
    rc = xa.cmd_wire(env, ["CRAZY=crazy4marketingg", "JUNKIES=marketing_junkies"], ask_pin=lambda prompt: next(pins))
    assert rc == 1, "one refusal makes the run report failure"
    v = _values(env)
    assert v["TWITTER_CRAZY_ACCESS_TOKEN"] == "41-ACCESS" and v["TWITTER_CRAZY_ACCESS_SECRET"] == "SECRET-41"
    assert v["TWITTER_CRAZY_API_KEY"] == "key" and v["TWITTER_CRAZY_API_SECRET"] == "sec"
    assert "TWITTER_JUNKIES_ACCESS_TOKEN" not in v, "a personal login is refused, not wired to the site"
    out = capsys.readouterr().out
    assert "wired   CRAZY: @crazy4marketingg" in out and "@sudhanshu_personal, not @marketing_junkies" in out
    assert "41-ACCESS" not in out and "SECRET-41" not in out and "sec" not in out.replace("secret", "").replace("Secret", "")
    assert len([c for c in calls if c[0].endswith("access_token")]) == 2


def test_an_empty_pin_skips_the_site_without_calling_x_for_a_token(xa, tmp_path, monkeypatch):
    env = tmp_path / ".env"; env.write_text("X_API_KEY=key\nX_API_SECRET=sec\n")
    http_post, calls = _fake_x({})
    monkeypatch.setattr(xa, "http_post", http_post)
    rc = xa.cmd_wire(env, ["SCREENSTAT=screenstat"], ask_pin=lambda prompt: "")
    assert rc == 1 and "TWITTER_SCREENSTAT_ACCESS_TOKEN" not in _values(env)
    assert all(c[0].endswith("request_token") for c in calls)


def test_unknown_site_keys_are_rejected_before_any_network_call(xa, tmp_path, monkeypatch):
    env = tmp_path / ".env"; env.write_text("X_API_KEY=key\nX_API_SECRET=sec\n")
    monkeypatch.setattr(xa, "http_post", lambda *a: pytest.fail("must not call X"))
    assert xa.cmd_wire(env, ["BOGUS=someone"], ask_pin=lambda p: "1") == 1
