=== Filmybuff ===
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
License: GPLv2 or later

The filmybuff.com theme, built from the Filmy Buff brand kit (Modernist system): paper ground
#f3f2f2, surface #eae9e9, ink #201e1d, signal red #ec3013 with a warmer #e15b47 for dark grounds,
Archivo at 800 for headings, square corners, two-pixel rules, uppercase tracked kickers. The lockup
(a bordered box, FILMY over BUFF, the red square) is drawn in HTML/CSS exactly as the kit draws it,
so it stays crisp at every size; PNG exports for the site icon, social cards and the autopub share
cards are in assets/img.

Templates: front-page (lead story + three, section rails, an ink "Fresh on OTT" strip, the box
office ledger, trailers, latest + sidebar), single (kicker, dek, byline, share, tags, related),
archive/category (with section tabs), search, page, 404, comments.

Homepage modules read the sections autopub files under: Bollywood, Hollywood, South Cinema (rails),
OTT Releases (strip), Box Office (ledger), Trailers (row). Slugs are editable under
Appearance -> Customize -> Filmybuff, along with the top bar, Instagram handle, newsletter and footer.

Deployed by infra/wp/init-sites.sh (LOCAL_THEMES) and refreshed by infra/wp/deploy-themes.sh.
