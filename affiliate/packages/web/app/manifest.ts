import type { MetadataRoute } from 'next';
import { siteName } from '../lib/site';
import { SITE_DESCRIPTION } from '../lib/site-copy';

export const dynamic = 'force-dynamic';

/** PWA manifest. Colours are the ground token (--color-bg); a manifest cannot read CSS. */
export default function manifest(): MetadataRoute.Manifest {
  const name = siteName();
  return {
    name,
    short_name: name === 'Afflino' ? 'afflino' : name.length > 12 ? (name.split(/\s+/)[0] ?? name) : name,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#F3F2F2',
    theme_color: '#F3F2F2',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
