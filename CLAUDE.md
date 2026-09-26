# Marketing fleet: standing rules

Rules the owner has set for the content this repository publishes. They apply to every site and every
social channel, and each has a test or a setting behind it; change the code, not just the note.

## Cinema clips: 30 seconds, never more (trailers excepted)

A cinema clip (a scene, a song, a monologue, any film footage fetched from YouTube) is never posted
longer than **30 seconds**, on the website, as a reel, or as a Facebook video. The one exception is a
trailer, which keeps the ad-clip limit. Enforced by `settings.scene_clip_max_seconds` and
`adclip.trim` in `autopub/autopub/scenes.py`; the article's YouTube embed of the original is not
our hosting and may be the full clip.

## Type never sits on a face

Every renderer keeps its type off people's faces: the crop moves the subject, the type moves to the
clear band, or the type-only card stands in. `tests/test_no_text_on_faces.py`.

## High quality, always

Fetch the largest copy of a still, enhance once, save at JPEG 90 with full chroma, encode video at
CRF 18. A still too small to fill a 3:4 poster is letterboxed, not blown up.

## Filmybuff is curated, not a wire

filmybuff.com and its Instagram carry the same 3:4 poster, built on an original frame from the film
(TMDB), in the print-grade look with cream type. The day is the formats (deep dives, watchlists and
ranked lists, trailers, scenes) and the news post is held to `news_hours`. Scenes start from what is
already viral on YouTube, on rights holders' channels only, and the page breaks the scene down beat
by beat.

## Operations

Secrets are entered through hidden prompts, never printed. Commands given to the owner are single
lines with no placeholders; the server has no `make`, no node, no `dig`. Rebuild with
`cd /opt/marketing-fleet && git fetch origin && git merge --ff-only origin/claude/wordpress-multisite-auto-publish-o2zlsd && docker compose up -d --build --remove-orphans`
and ship themes with `./infra/wp/deploy-themes.sh`.
