=== Screenstat ===

A WordPress block theme for film and streaming statistics.

== Install ==

1. WordPress admin > Appearance > Themes > Add New > Upload Theme
2. Choose screenstat.zip, install, activate.
3. Appearance > Editor to change anything visually. All colours, fonts and
   spacing live in theme.json and are editable in the Styles panel.

Requires WordPress 6.4 or later. Block themes need no page builder.

== Setting up ==

Logo:      Appearance > Editor > Styles, or Customise > Site Identity.
           Use assets/images/logo-white.svg in the header (dark background)
           and assets/images/mark.svg for the site icon / favicon.
Menu:      Appearance > Editor > open the header part > edit Navigation.
Front page: Settings > Reading > set a static page, then the "home" template
           renders the hero, figure grid, latest posts and buzz slot.
Sourcing page: create a page at /sourcing/ — the footer already links there.

== What's included ==

Templates   index, home, single, page, page-wide, archive, search, 404
Parts       header (ink), footer (ink)
Patterns    Homepage hero, Figure grid, Day-wise collections table,
            Source note, Buzz tool placeholder
Block styles Group > "Figure", Group > "Stat card", Paragraph > "Source line"
Shortcode   [screenstat_read_time]

== Brand tokens ==

Coral        #EE5A3C   primary, accents, links
Coral dark   #C8412A   hover
Ink          #16181D   text, header, footer
Ink soft     #2B2F36   dividers on dark
Muted        #5C6068   secondary text, source lines
Border       #E4E2DD   card and table rules
Surface      #F7F6F3   source note background
Cream        #F4EDE2   buzz module background
Typeface     Inter variable, bundled locally (no Google Fonts request)

== Working with numbers ==

Tabular figures are on site-wide, so digits align in columns without effort.
For a table of numbers, add the CSS class "num" in the table block's
Advanced panel — that right-aligns every column except the first.

Every figure should carry a source. Use the "Source line" paragraph style,
which prefixes the text with "Source:" automatically, or insert the
Source note pattern at the end of a post.

== Fonts licence ==

Inter is included under the SIL Open Font License 1.1.
See LICENSE-Inter.txt.
