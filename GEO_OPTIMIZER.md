# GEO Optimizer: AI Visibility for the Marketing Fleet

GEO Optimizer audits whether your published content is visible and citable by AI answer engines (ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews). A 0-100 score tells you if AI engines will find, understand, and cite your articles.

## Why AI Visibility Matters

- **ChatGPT** alone has 900M weekly users — a growing share of search traffic
- AI engines **cite 3-5 sources** in their answer, not 100 like Google. If you're not one of them, you're invisible
- **28% of top ChatGPT citations have zero Google organic visibility** — AI rewards different signals
- Proper `llms.txt`, JSON-LD schema, and content structure increase citation rate from 16% to 54%

## Audit Your Site

**Single site audit:**
```
Ask Claude: "Audit filmybuff.com for AI visibility. What's the score and what should we fix?"
```

This runs `geo_audit` and returns:
- AI visibility score (0-100)
- 8 categories: discovery, crawlability, schema, content structure, entity coherence, citability, trust, negative signals
- Exact fixes needed (llms.txt content, JSON-LD schema, robots.txt rules)

**Compare all five sites:**
```
Ask Claude: "Compare AI readiness across filmybuff.com, crazy4marketing.com, screenstat.in, 
marketingmentalist.in, and marketingjunkies.in. Which needs the most work?"
```

This runs `geo_compare` and shows:
- Scores for each domain
- Which site has the best AI visibility
- Gaps to fix in each

**Gap analysis between two competitors:**
```
Ask Claude: "Compare our AI visibility to competitor.com. What are they doing that we're not?"
```

This runs `geo_gap_analysis` and shows:
- What they have that we're missing
- Prioritized fixes with ROI
- Exact implementation steps

## Generate Fixes

**Auto-generate llms.txt:**
```
Ask Claude: "Generate llms.txt for filmybuff.com. Include the site's niche, audience, contact, and guidelines."
```

Returns `llms.txt` ready to drop at `https://filmybuff.com/llms.txt`. This file tells AI engines what your site is, who it's for, and what content it has.

**Validate JSON-LD schema:**
```
Ask Claude: "Check if our schema markup is valid and complete for a movie review page."
```

Returns:
- Validation status (valid, missing fields, incorrect types)
- Exact JSON-LD to add to pages
- Which pages need which schema

**Check robot access:**
```
Ask Claude: "Check if ChatGPT, Perplexity, Claude, and Gemini bots can access filmybuff.com."
```

Returns:
- Current robots.txt rules
- Which bots are blocked
- Rules to add for AI engines (ChatGPT-Web, PerplexityBot, CCBot, Google-Extended)

## Verify AI Citations

**Does AI actually cite you?**
```
Ask Claude: "Check if ChatGPT and Perplexity cite filmybuff.com when asked about box office or trailers."
```

This runs `geo_citations` and queries real engines:
- ChatGPT: "latest box office collection India"
- Perplexity: "best films to watch on OTT"
- Returns whether filmybuff.com is mentioned and cited

**Content citability audit:**
```
Ask Claude: "Analyze filmybuff.com for content citability. Which pages are most citable to AI?"
```

Returns:
- Citability score per page (0-100)
- 47 AI-citation signals checked (schema, structure, factual density, citations, entity coherence)
- Pages to optimize for better AI citations

## Standing Rules for AI Visibility

All five sites must follow these GEO rules for consistent AI readiness:

1. **llms.txt at `/llms.txt`** — tells AI engines what your site is
   - Site description, audience, niche, categories
   - Contact email and preferred attribution
   - Content guidelines (off-limits topics, brand voice)

2. **JSON-LD schema on every page**
   - Article schema for news posts (headline, description, datePublished, author, image)
   - NewsArticle for breaking news
   - BreadcrumbList for navigation
   - Organization schema on homepage (name, logo, contact, social profiles)

3. **Robots.txt allows AI bots**
   - ChatGPT-Web, PerplexityBot, CCBot, Google-Extended, Omgilibot
   - Do NOT block these under `Disallow:/`

4. **Clear content structure**
   - H1, H2, H3 hierarchy (one H1 per page)
   - Short paragraphs (2-3 sentences max)
   - Bullet points for lists
   - Clear topic sentences

5. **Factual citations**
   - Source links for claims (e.g., "according to [source]")
   - No unsourced assertions that contradict public knowledge
   - Specific dates and numbers (not "recently" or "many")

## Workflow: Publish → Audit → Fix → Monitor

### 1. Publish with GEO in mind
- Include schema markup during page creation
- Write in clear structure (H1 → H2/H3 → paragraphs)
- Link to sources for factual claims

### 2. Audit (within 24 hours of publish)
```bash
# One-liner audit
Ask Claude: "Audit the new pages we published today on filmybuff.com"

# Or manually in Claude Code
mcp__geo__geo_audit(url="https://filmybuff.com/new-article")
```

### 3. Fix recommendations
```bash
# Get fixes
Ask Claude: "What fixes are needed for filmybuff.com to improve AI visibility?"

# Generate specific files
mcp__geo__geo_fix(url="https://filmybuff.com")
mcp__geo__geo_llms_generate(url="https://filmybuff.com")
mcp__geo__geo_schema_validate(url="https://filmybuff.com")
```

### 4. Monitor over time
Run monthly audits to track:
- Score trend (should improve with each optimization)
- Which categories improved
- New citation opportunities

## Example Output

```
AUDIT: filmybuff.com
Score: 64/100

DISCOVERY (18/25)
  ✓ AI crawlers can access site
  ✓ Sitemap.xml present
  ✗ llms.txt missing → ADD llms.txt with site description

CRAWLABILITY (22/25)
  ✓ Robots.txt allows ChatGPT-Web, PerplexityBot
  ✗ 3 pages blocked by meta robots=noindex → Remove from index
  ✓ Clear URL structure

SCHEMA (15/25)
  ✓ Article schema on news pages
  ✗ Missing NewsArticle schema for breaking news
  ✗ Organization schema incomplete (missing logo URL)
  → ADD complete Organization schema to homepage

CONTENT STRUCTURE (16/20)
  ✓ Clear H1→H2 hierarchy
  ✗ One page has 8 consecutive paragraphs (should break at 3)
  → Break long paragraphs into shorter sections

ENTITY COHERENCE (10/20)
  ✓ Consistent brand name
  ✗ Inconsistent movie title formatting (War 3 vs War3)
  → Standardize title formatting across site

CITABILITY (12/20)
  ✓ Factual claims sourced
  ✗ 5 pages have unsourced opinions presented as fact
  → Add "[According to...]" or move to author bio

TRUST (8/15)
  ✗ No contact email in site header
  ✗ No "About us" page
  ✓ HTTPS enforced
  → ADD contact + about pages, link from footer

NEGATIVE SIGNALS (3/10)
  ✓ No ad-blocking detection
  ✗ Heavy JavaScript on hero image (blocks text extraction)
  ✗ Paywall on premium articles (no preview)
  → Lazy-load JS, allow preview paragraph for AI crawlers
```

## Integration with SEO_INTEGRATION.md

**OpenSEO (Pre-publish)** → Keyword research before writing
**GEO Optimizer (Post-publish)** → Verify AI visibility & citability
**GSC (Analytics)** → Track which queries bring visitors

Combined workflow:
1. Research keywords (OpenSEO)
2. Write article with schema markup
3. Publish
4. Audit AI visibility (GEO Optimizer)
5. Fix any issues
6. Monitor citations (GEO citations)
7. Analyze performance (GSC)

## Troubleshooting

**Score is low (below 50)**
- Check that llms.txt exists and is accessible at `/llms.txt`
- Validate JSON-LD schema (should be in `<head>`, not at bottom)
- Make sure robots.txt doesn't block ChatGPT-Web or PerplexityBot
- Break up long paragraphs (AI prefers short paragraphs)

**Schema validation fails**
- Use Google's Rich Results Test: https://search.google.com/test/rich-results
- Common issues: missing required fields, wrong types, nested errors
- Generate correct schema with `geo_schema_validate`

**AI engines don't cite you**
- Check if they can access your site: `geo_check_bots`
- Verify citations are sourced (AI avoids unsourced claims)
- Check content density (AI prefers factual, specific content)
- Wait 2-4 weeks after publish for AI crawlers to process

**What about Google traditional SEO?**
- GEO complements SEO; schema markup and robots.txt help both
- GSC measures Google visibility; GEO measures AI visibility
- They reward different signals: backlinks (SEO) vs. schema (GEO)
- Do both for maximum visibility

