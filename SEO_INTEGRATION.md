# SEO Integration Across the Marketing Fleet

This guide explains how to set up and use Google Search Console (GSC) and OpenSEO across all five websites: Filmybuff, Crazy4Marketing, ScreenStat, Marketing Mentalist, and Marketing Junkies.

## Google Search Console (GSC) Integration

### Setup (One-Time)

1. **Authenticate with Google**
   - In an interactive Claude Code session, call `mcp__gsc__get_capabilities`
   - This triggers an OAuth browser flow; sign in with your Google account
   - GSC will ask for permission to access your Search Console properties

2. **Verify All Properties in Google Search Console**
   - Each domain must be added to Google Search Console at https://search.google.com/search-console
   - Verify ownership (via DNS, HTML file upload, or Google Tag Manager)
   - Properties to add:
     - filmybuff.com
     - crazy4marketing.com
     - screenstat.in
     - marketingmentalist.in
     - marketingjunkies.in

3. **Confirm Authentication in Claude Code**
   - Run `mcp__gsc__list_properties` to see all verified domains
   - All five should appear; if not, wait 24 hours for verification to propagate

### Using GSC Across All Sites

**Query Performance by Domain:**
```
Analyze search queries for filmybuff.com over the last 30 days.
Show top 20 queries by clicks, with CTR and average position.
```

**Compare Performance Across Domains:**
```
Get performance overview for all five sites (filmybuff.com, crazy4marketing.com, 
screenstat.in, marketingmentalist.in, marketingjunkies.in) for the last week.
Compare which domain has the highest CTR and impressions.
```

**Identify Indexing Issues:**
```
Check indexing status for these pages on filmybuff.com:
- https://filmybuff.com/
- https://filmybuff.com/trailers/
- https://filmybuff.com/watchlists/
```

**Analyze Specific Content:**
```
Show search analytics for this page on crazy4marketing.com:
https://crazy4marketing.com/digital-marketing/
Which queries drive traffic? What is the click-through rate?
```

**Track Rankings Over Time:**
```
Compare search performance for marketingmentalist.in between 
August 1-31, 2026 and September 1-30, 2026.
Which keywords gained position? Which lost it?
```

## OpenSEO Integration

OpenSEO is used at **article publication time** to research keywords before writing, not for post-analysis.

### Setup (Already Done)

- OpenSEO runs as a Docker service (loopback:3001, internal network only)
- API key configured in .env: `DATAFORSEO_API_KEY`
- Integrated into the publishing pipeline: `python -m autopub seo ...`

### Usage in Publishing

When the pipeline publishes a new article:
1. autopub extracts the story title
2. Calls OpenSEO to research keywords for that title (e.g., "War 3 box office")
3. Returns top 5 keywords sorted by relevance and search volume
4. Passes keywords to the writer in the brief

The writer is instructed to use the primary keyword naturally in the title, slug, excerpt, and first paragraph, with secondary keywords where they read naturally.

### Manual Research

To research keywords before pitching a story idea:
```bash
python -m autopub seo research --title "Akshay Kumar's comeback: what the box office tells us"
```

Returns:
- Keyword with monthly search volume and difficulty
- Which keywords are most relevant to the topic
- Ones too hard for a new site to rank for

### Rank Tracking

After publishing a set of articles, track their performance:
```bash
python -m autopub seo track --site FILMYBUFF --keywords "keyword1,keyword2,keyword3"
```

This adds the keywords to OpenSEO's rank tracker for the site and checks current rankings. Run weekly to monitor growth.

## Workflow: From Research to Publication to Analysis

### 1. Pre-Publication (OpenSEO)
- Research keywords for the story topic
- Identify 3-5 target keywords
- Writer uses them naturally in the article

### 2. Post-Publication (OpenSEO, 1+ weeks)
- Once articles are indexed, start rank tracking
- `python -m autopub seo track` weekly to monitor positions

### 3. Analytics & Reporting (GSC)
- After 2+ weeks of traffic, GSC data becomes available
- Check which queries bring visitors
- Compare to target keywords: are we ranking?
- Identify new keywords the article ranks for

### 4. Iteration
- Analyze GSC data to find:
  - Keywords we rank for but don't appear in title/excerpt
  - Low-CTR positions (39th): rewrite title/snippet for click-through
  - New long-tail opportunities discovered by visitors
- Add high-opportunity keywords to the SEO optimization checklist

## Standing Rules

**Cinema clips**: Never post longer than 30 seconds (trailers excepted).
- Enforced by `settings.scene_clip_max_seconds` = 30
- Applied in `adclip.trim()` before upload

**Quality**: JPEG 90, full chroma, CRF 18 video.
- Stills too small to fill the 3:4 poster are letterboxed, not blown up
- Enforced in `poster.py`

**Filmybuff Curation**: News held to `news_hours` (9am, 2pm, 8pm UTC+5:30).
- Day is the formats: watchlists, trailers, scenes, deep dives
- News posts only at scheduled hours

## Troubleshooting

**GSC not showing data for my site**
- Verify the domain is added and owned in Google Search Console
- Wait 3-5 days after first publication for data to appear
- Check that traffic is coming to the domain (not blocked by robots.txt)

**Rank tracking says 0 rankings**
- New domains take 4+ weeks to appear in search results
- Run tracking again after 1 month of publishing

**OpenSEO research returns no results**
- Check that DataForSEO API key is valid
- Keyword may be too new or too niche for OpenSEO's database
- Try a simpler version of the keyword

**GSC tools not available**
- Call `mcp__gsc__get_capabilities` to re-authenticate
- Check that OAuth token hasn't expired (usually 1 hour)

