=== Filmybuff ===
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
License: GPLv2 or later

The filmybuff.com theme, a cinema hall built from the Filmy Buff brand kit (Modernist system) with
the kit's ink #201e1d as the ground, paper #f3f2f2 as the type and the article sheet, signal red
#ec3013 (a warmer #e15b47 for type on ink), Archivo at 800/900, square corners, two-pixel rules,
uppercase tracked kickers. The lockup (a bordered box, FILMY over BUFF, the red square) is drawn in
HTML/CSS exactly as the kit draws it; PNG exports for the site icon, social cards and the autopub
share cards are in assets/img.

The language is posters, not grids, and since 2.1 the front page is a bill: the type on the ink and
the stills in their own frames, never one set over the other. A red marquee above the masthead; the
lead story with its headline beside the still and the three next to it numbered beneath; "fresh
prints", the latest six with the still above the type; a "what to watch" shelf of 2:3 sleeves with
the title under the poster; the sections as numbered "screens"; a paper box office board with red
digits; trailers with a play mark and the title beneath the frame; OTT arrivals as ticket stubs; a
red stub band for follow and newsletter; film-strip sprocket edges between acts. Articles: the
still as a hero, a paper "stub row" for date, running time, reviewer and share, the body on a paper
sheet with a drop cap and ink pull quotes, then "also showing" posters. Archives are a poster wall.

Homepage modules read the sections autopub files under: Bollywood, Hollywood, South Cinema (screens),
Watchlists (shelf), Box Office (board), OTT Releases (stubs), Trailers (row). Slugs are editable under
Appearance -> Customize -> Filmybuff, along with the marquee, Instagram handle, newsletter and footer.

Deployed by infra/wp/init-sites.sh (LOCAL_THEMES) and refreshed by infra/wp/deploy-themes.sh.
