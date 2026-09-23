=== Fleet Link in Bio ===
Serves /bio/ on each fleet site: the brand, its Instagram and Facebook accounts, and the newest
stories as tappable cards. Point the Instagram profile link at https://<site>/bio/.

The brand (colours, typeface, logo, social handles) is chosen by the site's hostname from
includes/brands.php, which mirrors autopub/config/sites.yaml. The page is cached for five minutes
and refreshed whenever a post is saved. It is marked noindex: it exists for the profile link, not
for search.

Preview without WordPress:  php tests/preview.php > /tmp/bio.html
