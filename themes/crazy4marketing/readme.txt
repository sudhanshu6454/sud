=== Crazy4 Marketing ===
Version: 1.0.0  ·  Requires WP 6.0+, PHP 7.4+

INSTALL
1. Appearance → Themes → Add New → Upload Theme → crazy4marketing.zip → Activate.
2. Settings → Reading → "A static page" is NOT required: front-page.php renders the homepage automatically.

SET UP (5 minutes)
- Categories: create News, Viral, Brands, Trends, Hot Takes, Insights (slugs: news, viral, brands, trends, hot-takes, insights). Add a "breaking" category for the ticker.
- Appearance → Menus: assign a menu to "Primary (header sections)" and the three footer locations. Without menus, the theme falls back to top categories.
- Appearance → Customize → Crazy4 Marketing: ticker text, Instagram handle, newsletter form action URL (Mailchimp/Beehiiv), Instagram tiles, homepage rail categories, Hot Take category.
- Lead story: mark a post Sticky (Post → Visibility → Stick to top). Otherwise the newest post leads.
- About page: create a page, set Template = "About / Contact". The page excerpt becomes the big headline. Add a Contact Form 7 / WPForms shortcode via a custom field "c4_contact_shortcode" for a real mail-sending form.
- Post excerpts become the dek (subtitle). Featured image caption becomes the hero caption.

BRAND
Space Grotesk (Google Fonts) · Core Black #0A0A0A · Signal Pink #FF3366 · Paper Cream #F5F1EA · Muted Grey #8C8C8C.
Assets in /assets: symbol, lockups, Instagram post templates, highlight covers.

NOTES
- "Trending" ranks by a lightweight view counter (post meta c4_views), falling back to newest posts.
- No build step, no jQuery, no plugins required.
