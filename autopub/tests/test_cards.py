"""The Instagram card family: a chooser that mixes formats without inventing content, and four
renderers that change the middle of the card and nothing else about the brand."""
from PIL import Image

from autopub import cards, images
from autopub.cards import HEADLINE, LIST, QUESTION, QUOTE, STAT, CardIdeas
from autopub.rewrite import CuratedPost
from autopub.state import State

FULL = CardIdeas(quote="Nobody buys what you sell.", quote_by="Rory Sutherland, Ogilvy",
                 stat="68%", stat_label="of shoppers say price is not their first filter", stat_context="Kantar 2026",
                 takeaways=["One", "Two", "Three"], question="Why does a higher price feel more trustworthy?")


def test_only_material_the_source_supports_unlocks_a_format():
    assert cards.supported(None) == [HEADLINE]
    assert cards.supported(CardIdeas()) == [HEADLINE]
    assert cards.supported(CardIdeas(quote="A line", quote_by=None)) == [HEADLINE], "a quote with nobody behind it is not a quote card"
    assert cards.supported(CardIdeas(stat="68%")) == [HEADLINE], "a figure with no label is not a number card"
    assert cards.supported(CardIdeas(takeaways=["one", "two"])) == [HEADLINE], "two takeaways are not three"
    assert cards.supported(CardIdeas(question="Not a question")) == [HEADLINE]
    assert set(cards.supported(FULL)) == set(cards.FORMATS)


def test_the_chooser_never_repeats_a_format_three_times_and_prefers_the_striking_one():
    history: list[str] = []
    seen = []
    for _ in range(8):
        kind = cards.choose(history, FULL)
        assert kind not in history[-cards.HISTORY:], f"{kind} repeated within the last {cards.HISTORY}"
        history = cards.remember(history, kind)
        seen.append(kind)
    assert seen[0] == QUOTE, "a quotable line beats a headline for the first card"
    assert len(set(seen)) >= 4, "eight posts should show most of the family"
    assert HEADLINE in seen, "headline cards still come round in the rotation"


def test_headline_only_material_keeps_posting_instead_of_stalling_on_variety():
    history = [HEADLINE, HEADLINE]
    assert cards.choose(history, None) == HEADLINE


def test_when_every_supported_format_is_recent_the_oldest_wins():
    ideas = CardIdeas(quote="Q", quote_by="A")            # supports headline + quote only
    assert cards.choose([QUOTE, HEADLINE], ideas) == QUOTE   # quote is older than headline
    assert cards.choose([HEADLINE, QUOTE], ideas) == HEADLINE


def test_briefs_carry_the_format_kicker_and_scrub_stray_quote_marks():
    b = cards.brief(QUOTE, CardIdeas(quote='"Nobody buys what you sell."', quote_by="  Rory  "), "H", "", None)
    assert b.kind == QUOTE and b.quote == "Nobody buys what you sell." and b.quote_by == "Rory"
    assert b.kicker == cards.KICKERS[QUOTE]
    b = cards.brief(LIST, FULL, "Headline", "", None)
    assert b.items == ["One", "Two", "Three"]
    b = cards.brief(HEADLINE, FULL, "Headline", "Branding", "Standfirst")
    assert b.kicker == "Branding" and b.standfirst == "Standfirst"


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
        brief = cards.brief(kind, FULL, "A headline for the card", "Branding" if kind == HEADLINE else cards.KICKERS[kind], None)
        path = images.render_card("A headline for the card", "Branding", site, tmp_path / f"{kind}.jpg", "portrait", card=brief)
        with Image.open(path) as im:
            assert im.size == (1440, 1920), kind
            small = im.convert("RGB").resize((90, 120))
            colours = {c for _, c in small.getcolors(maxcolors=1 << 20)}
        near_accent = any(sum(abs(a - b) for a, b in zip(c, accent)) < 90 for c in colours)
        assert near_accent, f"{kind} card lost the brand accent"


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
    assert cards.supported(post.card) == [HEADLINE, STAT, LIST]
