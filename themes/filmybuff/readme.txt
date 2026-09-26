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

The language is posters. Since 2.2 every image on the site is the 3:4 poster autopub makes for the
Instagram grid (the title on the still, the handle above, the lockup below) and every layout is built
around that poster: the theme's own type sits on the ink beside or beneath it, never over it. A red
marquee above the masthead; the lead story with its headline beside its poster and the three next to it
numbered beneath; "fresh prints", the latest eight posters four across; a "what to watch" shelf of
watchlist posters; the sections as numbered "screens"; a paper box office board with red digits;
trailers as one poster with a play mark and a list beside it; OTT arrivals as ticket stubs; a red stub
band for follow and newsletter; film-strip sprocket edges between acts. Articles: the poster beside the
headline, a paper "stub row" for date, running time, reviewer and share, the body on a paper sheet with
a drop cap and ink pull quotes, then "also showing" posters. Archives and search are poster walls and
rows. The two image sizes are fb-poster (600x800) and fb-poster-lg (1200x1600); nothing is cropped to
another shape.

Homepage modules read the sections autopub files under: Bollywood, Hollywood, South Cinema (screens),
Watchlists (shelf), Box Office (board), OTT Releases (stubs), Trailers (row). Slugs are editable under
Appearance -> Customize -> Filmybuff, along with the marquee, Instagram handle, newsletter and footer.

Deployed by infra/wp/init-sites.sh (LOCAL_THEMES) and refreshed by infra/wp/deploy-themes.sh.
