"""Finding the ad on YouTube from the results page, without an API key, and choosing the right upload."""
import json

from autopub import youtube


def _page(videos):
    def renderer(v):
        return {"videoRenderer": {
            "videoId": v["id"], "title": {"runs": [{"text": v["title"]}]},
            "ownerText": {"runs": [{"text": v["channel"]}]},
            "lengthText": {"simpleText": v["length"]}, "viewCountText": {"simpleText": v["views"]}}}
    data = {"contents": {"twoColumnSearchResultsRenderer": {"primaryContents": {"sectionListRenderer": {
        "contents": [{"itemSectionRenderer": {"contents": [renderer(v) for v in videos] + [{"adSlotRenderer": {}}]}}]}}}}}
    return f"<html><script>var ytInitialData = {json.dumps(data)};</script></html>"


VIDEOS = [
    {"id": "aaa", "title": "Cadbury Dairy Milk Cricket Ad 1994 | Kuch Khaas Hai", "channel": "Cadbury Dairy Milk India", "length": "0:43", "views": "9,831 views"},
    {"id": "bbb", "title": "The Iconic Cadbury Dairy Milk Cricket Ad", "channel": "ckeds", "length": "1:03", "views": "10,39,620 views"},
    {"id": "ccc", "title": "Top 50 Indian ads of the 90s compilation", "channel": "Retro TV", "length": "42:10", "views": "2,00,000 views"},
    {"id": "ddd", "title": "my favourites altogether", "channel": "someone", "length": "3:12", "views": "11,271 views"},
]


def test_the_results_page_is_read_from_its_embedded_json():
    got = youtube.parse(_page(VIDEOS))
    assert [v["id"] for v in got] == ["aaa", "bbb", "ccc", "ddd"]
    assert got[1]["views"] == 1039620 and got[0]["seconds"] == 43 and got[2]["seconds"] == 2530
    assert youtube.parse("<html>nothing here</html>") == []


def test_the_brands_own_upload_wins_then_the_most_watched_with_the_brand_in_the_title():
    got = youtube.parse(_page(VIDEOS))
    best = youtube.choose(got, "Cadbury", "Kuch Khaas Hai")
    assert best["id"] == "aaa", "the brand's channel beats a fan upload with more views"
    fan_only = [v for v in got if v["id"] != "aaa"]
    assert youtube.choose(fan_only, "Cadbury", "Kuch Khaas Hai")["id"] == "bbb", "then the most watched ad-length upload"
    assert youtube.choose(got, "Amul", "Utterly Butterly") is None, "no upload with the brand in its title: nothing"
    assert youtube.choose([got[2]], "Indian", "") is None, "a 42-minute compilation is not the ad"


def test_find_ad_builds_the_url_and_thumbnail(monkeypatch):
    calls = []

    def fake_search(query, timeout=20):
        calls.append(query)
        return youtube.parse(_page(VIDEOS))

    monkeypatch.setattr(youtube, "search", fake_search)
    film = youtube.find_ad("Cadbury", "Kuch Khaas Hai", 1994)
    assert film["url"] == "https://www.youtube.com/watch?v=aaa" and film["thumbnail"].endswith("/aaa/maxresdefault.jpg")
    assert calls == ["Cadbury Kuch Khaas Hai 1994 ad"]
    monkeypatch.setattr(youtube, "search", lambda q, timeout=20: [])
    assert youtube.find_ad("Nobody", "Nothing") is None
