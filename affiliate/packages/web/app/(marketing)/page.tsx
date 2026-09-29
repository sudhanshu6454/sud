import type { Metadata } from 'next';
import { MarketingHome } from '@/components/marketing/MarketingHome';
import { pageMetadata } from '@/lib/seo';

/** Canonical and og:url on "/"; the title is the root default (the site name). */
export function generateMetadata(): Metadata {
  return pageMetadata('/');
}

/** afflino.com (design 1b). Static marketing copy; no API call, no demo data. */
export default function HomePage() {
  return <MarketingHome />;
}
