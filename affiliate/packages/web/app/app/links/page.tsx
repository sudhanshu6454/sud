import type { Metadata } from 'next';
import { LinkBuilder } from './LinkBuilder';

export const metadata: Metadata = { title: 'My links' };

/** Live link minting (POST /v1/links; was /portal/links). The 3c screen builds on it. */
export default function AppLinksPage() {
  return <LinkBuilder />;
}
