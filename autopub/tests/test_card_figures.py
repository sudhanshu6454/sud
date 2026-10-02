"""A data card never contradicts its own headline: the card only carries the title's figures."""
from autopub import cards
from autopub.cards import CardIdeas
from autopub.rewrite import Captions, CuratedPost


def test_one_figure_however_it_is_written():
    assert cards.figures("₹36.70 crore") == cards.figures("Rs. 36.7 cr") == cards.figures("₹367 million")
    assert cards.figures("Rs 1,00,000") == [("amt", 100000.0)], "Indian digit grouping"
    assert cards.figures("12 per cent") == cards.figures("12%") == [("pct", 12.0)]
    assert cards.figures("2.4M views") == cards.figures("2.4 million views")


def test_bare_numbers_are_not_figures():
    assert cards.figures("Drishyam 3, day 1, by 4 PM in 2026: a 5 min read") == []


def _post(title, **kw):
    base = dict(title=title, category="Box Office", slug="s", excerpt="e" * 120, body_html="<p>x</p>", tags=["a"],
                image_headline=kw.pop("image_headline", title), image_kicker="Box Office",
                captions=Captions(twitter="t", facebook="f", instagram="i", linkedin="l", pinterest_title="p",
                                  pinterest="p", telegram="t", threads="t"))
    base.update(kw)
    return CuratedPost(**base)


def test_the_4pm_figure_on_a_card_under_the_5pm_title_comes_off():
    post = _post("Drishyam 3 collects ₹36.70 crore by 4 PM on day one",
                 hook="Rs 33.50 cr and climbing", image_headline="Rs. 33.50 cr nett by 5 PM on day one",
                 card=CardIdeas(stat="Rs. 33.50 cr", stat_label="Day-one nett"))
    dropped = cards.drop_stray_figures(post, cards.reference_figures(post.title, post.body_html))
    assert len(dropped) == 3
    assert post.card.stat is None and cards.STAT not in cards.supported(post.card), "the chooser picks another format"
    assert post.hook is None and post.image_headline == post.title


def test_the_headlines_own_figure_stays_however_it_is_written():
    post = _post("Drishyam 3 collects ₹36.70 crore by 4 PM on day one", hook="Drishyam 3 outruns its prequel by 4 PM",
                 image_headline="₹36.7 cr before sunset", card=CardIdeas(stat="Rs 36.70 cr", stat_label="Day-one nett"))
    assert cards.drop_stray_figures(post, cards.reference_figures(post.title, post.body_html)) == []
    assert post.card.stat == "Rs 36.70 cr" and post.hook and post.image_headline == "₹36.7 cr before sunset"


def test_a_comparison_needs_one_side_to_be_the_headlines_figure():
    ref = cards.reference_figures("Drishyam 3 opens to ₹36.70 crore")
    keep = _post("Drishyam 3 opens to ₹36.70 crore",
                 card=CardIdeas(left_value="₹36.7 cr", left_label="Drishyam 3", right_value="₹29 cr", right_label="Drishyam 2"))
    assert cards.drop_stray_figures(keep, ref) == [] and keep.card.right_value == "₹29 cr"
    lose = _post("Drishyam 3 opens to ₹36.70 crore",
                 card=CardIdeas(left_value="₹33.5 cr", left_label="By 5 PM", right_value="₹29 cr", right_label="Drishyam 2"))
    assert cards.drop_stray_figures(lose, ref) and lose.card.left_value is None


def test_a_title_without_figures_checks_the_card_against_the_article():
    post = _post("Drishyam 3 storms the box office", body_html="<p>It made <b>₹36.70 crore</b> on day one.</p>",
                 card=CardIdeas(stat="₹36.70 cr", stat_label="Day one"))
    ref = cards.reference_figures(post.title, post.body_html)
    assert cards.drop_stray_figures(post, ref) == [], "a figure the article states may carry the card"
    invented = _post("Drishyam 3 storms the box office", body_html="<p>It made ₹36.70 crore on day one.</p>",
                     card=CardIdeas(stat="₹50 cr", stat_label="Day one"))
    assert cards.drop_stray_figures(invented, ref) and invented.card.stat is None
