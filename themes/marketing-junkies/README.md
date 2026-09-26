# Marketing Junkies theme

Block theme for marketingjunkies.in, built from the Claude Design handoff "Marketing Junkies · WordPress
single-post template" (1a desktop, 1b mobile, 1c colour and logo guidelines, 1d developer notes).

It is bind-mounted read-only into the `wp_junkies` and `cli_junkies` containers (`theme:` in
`autopub/config/sites.yaml` → `infra/gen_compose.py`) and activated by `infra/wp/init-sites.sh`. The other
sites keep `WP_THEME` (Astra).

## What is automatic

autopub posts need no editing. From the fields it publishes:

| autopub field | Where it shows |
| --- | --- |
| title | h1 · og:title · headline |
| excerpt | standfirst · meta description · og:description |
| categories[0] | kicker · breadcrumb · article:section |
| tags | outline tag row · article:tag · keywords |
| featured_media | black-and-white hero (preloaded, `fetchpriority=high`) · og:image · schema image |
| leading `<ul>` in content | Key takeaways box, marked speakable |
| `<h2>`s | anchored sections + "In this story" (sticky aside on desktop, collapsible below 1200px) |
| closing `Source:` paragraph | source line with "original coverage" note |
| `<section class="faq">` | FAQ block (first answer open) + FAQPage schema |

autopub writes the takeaways and the FAQ itself (`CuratedPost.content_html()` in `autopub/autopub/rewrite.py`).
The in-article ad goes between the second and third sections.

**Sponsored posts:** tag a post `sponsored`, or choose the *Sponsored article* template. Then the post gets the
sponsor banner and a "Partner content" kicker, and outbound links get `rel="sponsored"`. The schema type becomes
`AdvertiserContentArticle` with `Googlebot-News: noindex`, and the post is left out of the news sitemap. Set the
sponsor name in the post's `mj_sponsor_name` custom field (also writable over REST).

## Head, feeds and crawlers

- One JSON-LD graph per page: NewsMediaOrganization, WebSite + SearchAction, NewsArticle, BreadcrumbList,
  FAQPage, plus ProfilePage + Person on author archives.
- Open Graph, Twitter card and `article:*` tags. Yoast stays installed for the canonical, meta description,
  robots meta and XML sitemaps; the theme switches off Yoast's schema and social tags so nothing is duplicated.
- `/news-sitemap.xml` (last 48 h, no sponsored posts), `/llms.txt`, `/ads.txt`, full-text RSS.
- robots.txt names GPTBot, ClaudeBot, PerplexityBot and the other AI crawlers explicitly. The default is
  *allow*; switch to *block* in the Customizer.
- Archivo is self-hosted (variable woff2, Latin + Latin Extended, `font-display: swap`, SIL OFL in
  `assets/fonts/OFL.txt`).

## Settings

Go to **Appearance › Customize › Marketing Junkies**. Settings: ads on/off, ads.txt contents, newsletter form
action and field name, AI crawler policy, and the LinkedIn / X / Instagram / Telegram URLs (used in the footer
and in Organization.sameAs). Until a newsletter URL is set, the signup box reads "Coming soon".

Author profile links (Person.sameAs) are set on each user's profile screen.

## Ad units

Each unit is a fixed-size `.mj-ad__box[data-ad-slot][data-ad-sizes]`, so filling it causes no layout shift.
Point your ad server's slot definitions at these ids:

| slot | where | sizes |
| --- | --- | --- |
| `mj_leaderboard` | below header, desktop | 970×90, 728×90 under 1034px |
| `mj_mobile_banner` | below header, mobile | 320×50 |
| `mj_inarticle_1` | between 2nd and 3rd section | 336×280, 300×250 on mobile |
| `mj_sidebar_top` | sidebar | 300×250 |
| `mj_sidebar_sticky` | sidebar, sticky | 300×600 |
| `mj_newsletter_sponsor` | signup box | 88×24 logo |
| in-feed sponsored | 3rd Related card | latest post tagged `sponsored` |

Logged-in admins see each slot's id and size inside the box. The *Ad slot (in-article)* pattern adds
`mj_inarticle_2` for long reads.

## One-time site setup

- Publish the pages the header, footer and author box link to: `/about/`, `/editorial-policy/`,
  `/corrections/`, `/advertise/`, `/contact/`. Once they exist, `llms.txt` lists them.
- Optional: give the newsdesk author the URL the design uses:
  `docker compose run --rm cli_junkies user update autopub --user_nicename=mj-newsdesk --display_name="MJ Newsdesk"`.
- The header nav links to `/category/marketing-news/` and the tags Campaigns, Martech, Media, Agencies and
  Features. The theme creates those tags on activation so the links never 404. Edit the menu in the Site Editor.
