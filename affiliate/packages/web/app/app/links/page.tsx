import type { Metadata } from 'next';
import { LinkBuilder } from './LinkBuilder';

export const metadata: Metadata = { title: 'My links' };

/**
 * My links + link generator (design 3c; was /portal/links). Demo generator and
 * "My links" table (TEST data, no list endpoint in v1) plus the live
 * POST /v1/links minting path.
 */
export default function AppLinksPage() {
  return <LinkBuilder />;
}
