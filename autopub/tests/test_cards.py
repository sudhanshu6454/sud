"""The Instagram card family: a chooser that mixes formats without inventing content, and renderers
that change the middle of the card - or, for inverse and poster, the ground - and nothing else
about the brand."""
from PIL import Image

from autopub import cards, images
from autopub.cards import (CHECKLIST, HEADLINE, INVERSE, LIST, POSTER, QUESTION, QUOTE, STAT, TERM, VERSUS,
                           CardIdeas)
from autopub.rewrite import CuratedPost
from autopub.state import State
from tests.test_images import _fake_photo_fetch, _has_green

FULL = CardIdeas(quote="Nobody buys what you sell.", quote_by="Rory Sutherland, Ogilvy",
                 stat="68%", stat_label="of shoppers say price is not their first filter", stat_context="Kantar 2026",
                 takeaways=["One", "Two", "Three"], question="Why does a higher price feel more trustworthy?",
                 left_value="₹1,299", left_label="said they would pay", right_value="₹1,899", right_label="actually paid",
                 term="Anchoring bias", definition="The first number seen becomes the reference for every later price.",
                 dos=["Show the premium first", "Explain the price"], donts=["Lead with the cheapest", "Discount the flagship"])


BARE = [HEADLINE, INVERSE]    # the two formats that need nothing but a headline


def test_only_material_the_source_supports_unlocks_a_format():
    assert cards.supported(None) == BARE
    assert cards.supported(CardIdeas()) == BARE
    assert cards.supported(None, photo=True) == BARE + [POSTER], "a poster needs a photo and nothing else"
    assert cards.supported(CardIdeas(quote="A line", quote_by=None)) == BARE, "a quote with nobody behind it is not a quote card"
    assert cards.supported(CardIdeas(stat="68%")) == BARE, "a figure with no label is not a number card"
    assert cards.supported(CardIdeas(takeaways=["one", "two"])) == BARE, "two takeaways are not three"
    assert cards.supported(CardIdeas(question="Not a question")) == BARE
    assert cards.supported(CardIdeas(left_value="1", left_label="a", right_value="2")) == BARE, "half a comparison is not a comparison"
    assert cards.supported(CardIdeas(term="Anchoring")) == BARE, "a term without its definition is not a glossary card"
    assert cards.supported(CardIdeas(dos=["a", "b"], donts=["c"])) == BARE, "a checklist needs two of each"
    assert set(cards.supported(FULL, photo=True)) == set(cards.FORMATS)


def test_the_chooser_never_repeats_a_format_three_times_and_prefers_the_striking_one():
    history: list[str] = []
    seen = []
    for _ in range(len(cards.FORMATS)):
        kind = cards.choose(history, FULL, photo=True)
        assert kind not in history[-cards.HISTORY:], f"{kind} repeated within the last {cards.HISTORY}"
        history = cards.remember(history, kind, keep=len(cards.FORMATS))
        seen.append(kind)
    assert seen[0] == QUOTE, "a quotable line beats a headline for the first card"
    assert set(seen) == set(cards.FORMATS), "with full material every format comes round once before any repeats"
    assert seen.index(INVERSE) > seen.index(TERM), "formats that need no material come after those the story supplied"


def test_headline_only_material_alternates_headline_and_inverse_instead_of_stalling():
    history: list[str] = []
    seen = []
    for _ in range(4):
        kind = cards.choose(history, None)
        history = cards.remember(history, kind)
        seen.append(kind)
    assert seen == [INVERSE, HEADLINE, INVERSE, HEADLINE], "plain news still alternates two looks"


def test_when_every_supported_format_is_recent_the_oldest_wins():
    ideas = CardIdeas(quote="Q", quote_by="A")            # supports headline, inverse and quote only
    assert cards.choose([QUOTE, HEADLINE, INVERSE], ideas) == QUOTE   # quote is the oldest of the three
    assert cards.choose([HEADLINE, QUOTE, INVERSE], ideas) == HEADLINE


def test_briefs_carry_the_format_kicker_and_scrub_stray_quote_marks():
    b = cards.brief(QUOTE, CardIdeas(quote='"Nobody buys what you sell."', quote_by="  Rory  "), "H", "", None)
    assert b.kind == QUOTE and b.quote == "Nobody buys what you sell." and b.quote_by == "Rory"
    assert b.kicker == cards.KICKERS[QUOTE]
    b = cards.brief(LIST, FULL, "Headline", "", None)
    assert b.items == ["One", "Two", "Three"]
    b = cards.brief(HEADLINE, FULL, "Headline", "Branding", "Standfirst")
    assert b.kicker == "Branding" and b.standfirst == "Standfirst"
    assert cards.brief(INVERSE, None, "H", "Branding", None).kind == INVERSE
    assert cards.brief(POSTER, None, "H", "Branding", None).kind == POSTER
    assert cards.brief(VERSUS, FULL, "H", "", None).left_value == "₹1,299"
    assert cards.brief(CHECKLIST, FULL, "H", "", None).donts == ["Lead with the cheapest", "Discount the flagship"]
    assert cards.brief(TERM, FULL, "H", "", None).kicker == cards.KICKERS[TERM]


def test_history_round_trips_through_the_state_note_format():
    h = cards.remember(cards.remember([], STAT), QUESTION)
    assert cards.parse_history(cards.dump_history(h)) == [STAT, QUESTION]
    assert cards.parse_history("bogus,quote") == [QUOTE], "unknown names are dropped, not trusted"
    assert cards.parse_history(None) == []


def test_state_notes_persist_per_site(tmp_path):
    st = State(tmp_path / "s.db")
    assert st.note("CRAZY", "card_formats") is None
    st.set_note("CRAZY", "card_formats", "quote,stat")
    st.set_note("CRAZY", "card_formats", "quote,stat,list")
    assert st.note("CRAZY", "card_formats") == "quote,stat,list"
    assert st.note("JUNKIES", "card_formats") is None


def test_every_format_renders_a_full_size_portrait_in_the_brand_colours(site, tmp_path):
    accent = images.hex_to_rgb(site.brand.accent)
    for kind in cards.FORMATS:
        brief = cards.brief(kind, FULL, "A headline for the card", cards.KICKERS.get(kind, "Branding"), None)
        path = images.render_card("A headline for the card", "Branding", site, tmp_path / f"{kind}.jpg", "portrait", card=brief)
        with Image.open(path) as im:
            assert im.size == (1440, 1920), kind
            small = im.convert("RGB").resize((90, 120))
            colours = {c for _, c in small.getcolors(maxcolors=1 << 20)}
        near_accent = any(sum(abs(a - b) for a, b in zip(c, accent)) < 90 for c in colours)
        assert near_accent, f"{kind} card lost the brand accent"


def test_a_poster_without_a_usable_photo_falls_back_to_the_headline_card(site, tmp_path):
    brief = cards.brief(POSTER, None, "A headline for the card", "Branding", None)
    path = images.render_card("A headline for the card", "Branding", site, tmp_path / "p.jpg", "portrait", card=brief)
    with Image.open(path) as im:
        assert im.size == (1440, 1920)


def test_a_poster_with_a_photo_is_the_photo(site, tmp_path, monkeypatch):
    _fake_photo_fetch(monkeypatch, size=(1600, 2000))
    brief = cards.brief(POSTER, None, "A headline for the card", "Branding", None)
    path = images.render_card("A headline for the card", "Branding", site, tmp_path / "p.jpg", "portrait",
                              backdrop_url="https://cdn/photo.jpg", card=brief)
    with Image.open(path) as im:
        assert im.size == (1440, 1920)
    assert _has_green(path), "the photograph should fill the poster card"


def test_the_inverse_card_is_mostly_accent(site, tmp_path):
    brief = cards.brief(INVERSE, None, "A headline for the card", "Branding", None)
    path = images.render_card("A headline for the card", "Branding", site, tmp_path / "i.jpg", "portrait", card=brief)
    accent = images.hex_to_rgb(site.brand.accent)
    with Image.open(path) as im:
        small = im.convert("RGB").resize((30, 40))
        px = list(small.getdata())
    near = sum(1 for c in px if sum(abs(a - b) for a, b in zip(c, accent)) < 60)
    assert near > len(px) * 0.4, "the inverse card should be dominated by the accent colour"


def test_the_format_only_touches_the_portrait_card(site, tmp_path):
    brief = cards.brief(STAT, FULL, "Headline", cards.KICKERS[STAT], None)
    out = images.render_set("Headline", "Branding", site, tmp_path, "story", card=brief)
    with Image.open(out["landscape"]) as land, Image.open(out["square"]) as sq:
        assert land.size == (1200, 630) and sq.size == (1080, 1080)
    with Image.open(out["portrait"]) as por:
        assert por.size == (1440, 1920)


def test_the_instagram_crop_of_a_format_card_is_still_a_clean_4_5(site, tmp_path):
    brief = cards.brief(QUESTION, FULL, "Headline", cards.KICKERS[QUESTION], None)
    card = images.render_card("Headline", "Branding", site, tmp_path / "q.jpg", "portrait", card=brief)
    asset = images.instagram_asset(card, "4:5", tmp_path / "q-ig.jpg")
    with Image.open(asset) as im:
        assert im.size == (1440, 1800)


def test_curated_post_parses_with_and_without_card_material():
    base = dict(title="T", slug="t", excerpt="E", body_html="<p>x</p>", image_headline="H", image_kicker="K",
                captions=dict(twitter="", facebook="", instagram="", linkedin="", pinterest_title="", pinterest="",
                              telegram="", threads=""))
    assert CuratedPost(**base).card is None
    post = CuratedPost(**base, card={"stat": "68%", "stat_label": "of shoppers", "takeaways": ["a", "b", "c"]})
    assert post.card.stat == "68%" and post.card.quote is None
    assert cards.supported(post.card) == [HEADLINE, INVERSE, STAT, LIST]
