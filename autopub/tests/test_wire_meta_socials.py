"""infra/wire-meta-socials.py: the Facebook half must carry a Page token, never the System User token.

Facebook Page writes reject a user or system token under the new Pages experience (error 190,
subcode 2069032). The first version of the script copied the System User token into
FACEBOOK_<SITE>_PAGE_TOKEN and every Facebook post failed with exactly that. These tests pin the
contract: Instagram gets the System User token, Facebook gets a token minted for the Page, and a
failed mint writes nothing.
"""
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "infra" / "wire-meta-socials.py"
SYSTEM_TOKEN = "EAASYSTEMUSERTOKEN0000000000000000000000"
PAGE_TOKEN = "EAAPAGETOKENMINTEDFORTHEPAGE000000000000"

ASSETS = {"ig": [
    {"ig_user_id": "17841461969826055", "username": "crazy4marketingg", "page_id": "1424415010744386", "page_name": "Crazy4 Marketing"},
    {"ig_user_id": "17841400000000001", "username": "screenstat", "page_id": "100000000000001", "page_name": "ScreenStat"},
]}


@pytest.fixture
def wire():
    spec = importlib.util.spec_from_file_location("wire_meta_socials", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def files(tmp_path):
    env = tmp_path / ".env"
    env.write_text(f"WP_URL=https://x\nMETA_SYSTEM_USER_TOKEN={SYSTEM_TOKEN}\nOTHER=1\n", encoding="utf-8")
    assets = tmp_path / "assets.json"
    assets.write_text(json.dumps(ASSETS), encoding="utf-8")
    return env, assets


def _env(path: Path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines() if "=" in line)


def test_facebook_gets_a_minted_page_token_not_the_system_token(wire, files, capsys):
    env, assets = files
    asked = []

    def mint(page_id, system_token):
        asked.append((page_id, system_token))
        return PAGE_TOKEN

    wire.fetch_page_token = mint
    rc = wire.main(["CRAZY=crazy4marketingg", "--facebook", "--env", str(env), "--assets", str(assets)])
    assert rc == 0
    got = _env(env)
    assert got["INSTAGRAM_CRAZY_USER_ID"] == "17841461969826055"
    assert got["INSTAGRAM_CRAZY_ACCESS_TOKEN"] == SYSTEM_TOKEN, "Instagram publishes with the System User token"
    assert got["FACEBOOK_CRAZY_PAGE_ID"] == "1424415010744386"
    assert got["FACEBOOK_CRAZY_PAGE_TOKEN"] == PAGE_TOKEN, "Facebook needs the Page's own token"
    assert got["FACEBOOK_CRAZY_PAGE_TOKEN"] != SYSTEM_TOKEN
    assert asked == [("1424415010744386", SYSTEM_TOKEN)], "minted once, for the right Page, with the system token"
    assert got["OTHER"] == "1" and got["WP_URL"] == "https://x", "unrelated lines survive"
    out = capsys.readouterr().out
    assert SYSTEM_TOKEN not in out and PAGE_TOKEN not in out, "no token is ever printed"


def test_a_failed_mint_writes_nothing_and_names_the_page(wire, files, capsys):
    env, assets = files
    before = env.read_text(encoding="utf-8")

    def mint(page_id, system_token):
        if page_id == "100000000000001":
            raise RuntimeError("Unsupported get request. Object with ID '100000000000001' does not exist")
        return PAGE_TOKEN

    wire.fetch_page_token = mint
    rc = wire.main(["CRAZY=crazy4marketingg", "SCREENSTAT=screenstat", "--facebook", "--env", str(env), "--assets", str(assets)])
    assert rc == 1
    assert env.read_text(encoding="utf-8") == before, "one bad Page must not half-write the others"
    out = capsys.readouterr().out
    assert "SCREENSTAT" in out and "100000000000001" in out and "does not exist" in out
    assert "Nothing was written" in out
    assert SYSTEM_TOKEN not in out


def test_without_facebook_no_page_token_is_minted_or_written(wire, files):
    env, assets = files
    wire.fetch_page_token = lambda *a: pytest.fail("must not call Graph without --facebook")
    rc = wire.main(["CRAZY=crazy4marketingg", "--env", str(env), "--assets", str(assets)])
    assert rc == 0
    got = _env(env)
    assert got["INSTAGRAM_CRAZY_ACCESS_TOKEN"] == SYSTEM_TOKEN
    assert "FACEBOOK_CRAZY_PAGE_TOKEN" not in got and "FACEBOOK_CRAZY_PAGE_ID" not in got


def test_an_unknown_handle_still_fails_before_any_mint(wire, files):
    env, assets = files
    before = env.read_text(encoding="utf-8")
    wire.fetch_page_token = lambda *a: pytest.fail("handles are validated before any Graph call")
    rc = wire.main(["CRAZY=crazy4marketingg", "JUNKIES=marketing_junkies", "--facebook", "--env", str(env), "--assets", str(assets)])
    assert rc == 1
    assert env.read_text(encoding="utf-8") == before


def test_graph_error_text_never_carries_the_system_token(wire, monkeypatch):
    """Meta echoes a malformed token back in its error message; the script must scrub it."""
    import io
    import urllib.error

    body = json.dumps({"error": {"message": f"Malformed access token {SYSTEM_TOKEN}", "code": 190}}).encode()

    def fake_urlopen(url, timeout=30):
        assert SYSTEM_TOKEN in url, "the system token is what mints the Page token"
        raise urllib.error.HTTPError(url, 400, "Bad Request", {}, io.BytesIO(body))

    monkeypatch.setattr(wire.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError) as exc:
        wire.page_access_token("1424415010744386", SYSTEM_TOKEN)
    assert SYSTEM_TOKEN not in str(exc.value)
    assert "<redacted>" in str(exc.value)
