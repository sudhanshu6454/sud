import type { MetadataRoute } from 'next';
import { siteName } from '../lib/site';

export const dynamic = 'force-dynamic';

export default function manifest(): MetadataRoute.Manifest {
  const name = siteName();
  return {
    name,
    short_name: name.length > 12 ? name.split(/\s+/)[0] ?? name : name,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111111',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
