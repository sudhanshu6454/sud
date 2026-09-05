import json

from autopub.wordpress import WordPress, WordPressError


class FakeResp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self):
        self.headers = {}
        self.auth = None
        self.calls = []
        self.terms = {"categories": [{"id": 5, "name": "Marketing News"}], "tags": []}
        self.next_id = 100

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        path = url.split("/wp-json/wp/v2/")[1]
        if path in ("categories", "tags"):
            if method == "GET":
                q = kw["params"]["search"].lower()
                return FakeResp(200, [t for t in self.terms[path] if q in t["name"].lower()])
            name = kw["json"]["name"]
            if any(t["name"] == name for t in self.terms[path]):
                return FakeResp(400, {"code": "term_exists", "data": {"term_id": 5}})
            self.next_id += 1
            term = {"id": self.next_id, "name": name}
            self.terms[path].append(term)
            return FakeResp(201, term)
        if path == "media" and method == "POST":
            return FakeResp(201, {"id": 77, "source_url": "https://marketingjunkies.in/wp-content/uploads/x.jpg"})
        if path.startswith("media/"):
            return FakeResp(200, {"id": 77})
        if path == "posts":
            return FakeResp(201, {"id": 9, "link": "https://marketingjunkies.in/hello/", **kw["json"]})
        if path == "users/me":
            return FakeResp(401, {"code": "rest_not_logged_in"})
        raise AssertionError(path)


def test_headers_for_internal_access():
    s = FakeSession()
    WordPress("http://wp_junkies", "autopub", "aaaa bbbb", public_host="marketingjunkies.in", session=s)
    assert s.headers["Host"] == "marketingjunkies.in"
    assert s.headers["X-Forwarded-Proto"] == "https"
    assert s.auth == ("autopub", "aaaabbbb")
    s2 = FakeSession()
    WordPress("https://marketingjunkies.in", "autopub", "p", public_host="marketingjunkies.in", session=s2)
    assert "Host" not in s2.headers


def test_terms_media_and_post(tmp_path):
    s = FakeSession()
    wp = WordPress("https://marketingjunkies.in", "u", "p", session=s)
    assert wp.ensure_term("categories", "marketing news") == 5
    assert wp.ensure_term("tags", "AdTech") == 101
    assert wp.ensure_term("tags", "AdTech") == 101
    img = tmp_path / "a.jpg"
    img.write_bytes(b"\xff\xd8\xff")
    media = wp.upload_media(img, "A", alt_text="alt")
    assert media["id"] == 77
    upload_call = [c for c in s.calls if c[1].endswith("/media") and c[0] == "POST"][0]
    assert upload_call[2]["headers"]["Content-Type"] == "image/jpeg"
    post = wp.create_post(title="Hello", content="<p>x</p>", excerpt="e", slug="hello", category_ids=[5], tag_ids=[101], featured_media=77)
    assert post["featured_media"] == 77 and post["status"] == "publish"


def test_error_surface():
    wp = WordPress("https://marketingjunkies.in", "u", "p", session=FakeSession())
    try:
        wp.ping()
    except WordPressError as exc:
        assert "401" in str(exc)
    else:
        raise AssertionError
