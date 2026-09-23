"""infra/linkedin-auth.py: one login becomes credentials for every site, and never prints a secret."""
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "infra" / "linkedin-auth.py"
TOKEN = "AQV_MEMBER_TOKEN_0000000000000000000000"
NEW = "AQV_RENEWED_TOKEN_000000000000000000000"
ORGS = [
    {"urn": "urn:li:organization:111", "id": "111", "name": "Marketing Mentalist", "vanity": "marketing-mentalist"},
    {"urn": "urn:li:organization:222", "id": "222", "name": "Crazy4Marketing", "vanity": "crazy4marketing"},
    {"urn": "urn:li:organization:333", "id": "333", "name": "Marketing Junkies", "vanity": "marketingjunkies"},
]


@pytest.fixture
def li():
    spec = importlib.util.spec_from_file_location("linkedin_auth", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def env(tmp_path):
    p = tmp_path / ".env"
    p.write_text(f"WP_URL=x\nLINKEDIN_ACCESS_TOKEN={TOKEN}\nLINKEDIN_TOKEN_EXPIRES=2026-11-20\n"
                 f"LINKEDIN_REFRESH_TOKEN=RT\nLINKEDIN_CLIENT_ID=cid\nLINKEDIN_CLIENT_SECRET=sec\n", encoding="utf-8")
    return p


def _values(p: Path) -> dict:
    return dict(l.split("=", 1) for l in p.read_text().splitlines() if "=" in l)


def test_wire_maps_sites_to_pages_by_name_or_vanity_and_shares_the_token(li, env, capsys):
    rc = li.cmd_wire(env, ["MENTALIST=Marketing Mentalist", "CRAZY=crazy4marketing", "JUNKIES=junkies"], orgs=ORGS)
    assert rc == 0
    v = _values(env)
    assert v["LINKEDIN_MENTALIST_ORG_URN"] == "urn:li:organization:111"
    assert v["LINKEDIN_CRAZY_ORG_URN"] == "urn:li:organization:222"
    assert v["LINKEDIN_JUNKIES_ORG_URN"] == "urn:li:organization:333", "a unique substring of the name is enough"
    assert all(v[f"LINKEDIN_{s}_ACCESS_TOKEN"] == TOKEN for s in ("MENTALIST", "CRAZY", "JUNKIES"))
    assert TOKEN not in capsys.readouterr().out


def test_wire_refuses_ambiguous_or_unknown_pages_and_writes_nothing(li, env, capsys):
    before = env.read_text()
    rc = li.cmd_wire(env, ["CRAZY=crazy4marketing", "SCREENSTAT=screenstat", "JUNKIES=Marketing"], orgs=ORGS)
    assert rc == 1 and env.read_text() == before
    out = capsys.readouterr().out
    assert "SCREENSTAT" in out and "JUNKIES" in out and "Nothing was written" in out


def test_refresh_renews_the_token_everywhere_it_is_used(li, env, capsys):
    li.cmd_wire(env, ["CRAZY=crazy4marketing", "MENTALIST=marketing-mentalist"], orgs=ORGS)
    li.post_form = lambda url, data: {"access_token": NEW, "expires_in": 60 * 86400, "refresh_token": "RT2"} \
        if data.get("grant_type") == "refresh_token" else pytest.fail("unexpected grant")
    assert li.cmd_refresh(env) == 0
    v = _values(env)
    assert v["LINKEDIN_ACCESS_TOKEN"] == NEW and v["LINKEDIN_REFRESH_TOKEN"] == "RT2"
    assert v["LINKEDIN_CRAZY_ACCESS_TOKEN"] == NEW and v["LINKEDIN_MENTALIST_ACCESS_TOKEN"] == NEW
    assert "LINKEDIN_JUNKIES_ACCESS_TOKEN" not in v, "sites never wired stay unwired"
    out = capsys.readouterr().out
    assert NEW not in out and "RT2" not in out and "renewed" in out


def test_auth_exchanges_the_pasted_redirect_and_stores_client_and_tokens(li, tmp_path, monkeypatch, capsys):
    env = tmp_path / ".env"; env.write_text("WP_URL=x\n")
    prompts = iter(["client-123", "secret-abc"])
    pasted = {}

    def fake_getpass(prompt):
        if "Redirected" in prompt:
            return pasted["url"]
        return next(prompts)

    def fake_post(url, data):
        assert data["grant_type"] == "authorization_code" and data["code"] == "CODE9" and data["client_secret"] == "secret-abc"
        return {"access_token": TOKEN, "expires_in": 5184000, "refresh_token": "RT1", "refresh_token_expires_in": 31536000}

    real_print = li.print if hasattr(li, "print") else print
    printed = []

    def capture_print(*a, **k):
        printed.append(" ".join(str(x) for x in a))
        # the consent URL carries the state; the "browser" comes back with it
        for x in a:
            if isinstance(x, str) and x.startswith(li.AUTH_URL):
                from urllib.parse import parse_qs, urlparse
                st = parse_qs(urlparse(x).query)["state"][0]
                pasted["url"] = f"{li.REDIRECT}?code=CODE9&state={st}"

    monkeypatch.setattr(li.getpass, "getpass", fake_getpass)
    monkeypatch.setattr(li, "post_form", fake_post)
    monkeypatch.setattr(li, "print", capture_print, raising=False)
    assert li.cmd_auth(env) == 0
    v = _values(env)
    assert v["LINKEDIN_CLIENT_ID"] == "client-123" and v["LINKEDIN_CLIENT_SECRET"] == "secret-abc"
    assert v["LINKEDIN_ACCESS_TOKEN"] == TOKEN and v["LINKEDIN_REFRESH_TOKEN"] == "RT1"
    joined = "\n".join(printed)
    assert TOKEN not in joined and "secret-abc" not in joined and "RT1" not in joined
