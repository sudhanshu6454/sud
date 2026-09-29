import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { rootMetadata } from '../lib/seo';

/*
 * Archivo (SIL OFL 1.1, app/fonts/OFL.txt), self-hosted: no request to Google
 * Fonts from the browser. Each file is the variable wght axis (100–900), so
 * the 400/600/700/800 weights the design uses all come from one file.
 * Two faces because next/font/local cannot give each src its own
 * unicode-range: latin (A–Z, punctuation) and latin-ext (which carries ₹,
 * U+20B9). globals.css joins them as --font-archivo, ext first: the ranges
 * are disjoint, so order only matters for the latin face's metric-adjusted
 * local fallback, which must come after the real ₹ glyph, never before it.
 */
const archivoLatin = localFont({
  src: './fonts/archivo-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-archivo-latin',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const archivoLatinExt = localFont({
  src: './fonts/archivo-latin-ext-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-archivo-ext',
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

// Every route renders on demand so NEXT_PUBLIC_SITE_NAME (and the catalogue
// env) are read from the server's runtime environment, never baked at build.
export const dynamic = 'force-dynamic';

/**
 * Root metadata (lib/seo.ts): metadataBase = SITE_URL, the title template,
 * the description from lib/site-copy.ts, Open Graph (site name, website,
 * en_IN, og:url, the 512 px icon) and a summary Twitter card. A function, so
 * SITE_URL and NEXT_PUBLIC_SITE_NAME are read per request.
 */
export function generateMetadata(): Metadata {
  return rootMetadata();
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // --color-bg; a meta tag cannot read a CSS variable.
  themeColor: '#F3F2F2',
};

/**
 * Root layout: document, font variables and metadata only. Each area brings
 * its own chrome — (marketing) and (shop) the marketing nav and footer, /app,
 * /brand and /agency the sidebar shell, /admin the admin bar.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${archivoLatin.variable} ${archivoLatinExt.variable}`}>
      <body>{children}</body>
    </html>
  );
}
