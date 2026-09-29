import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { StubPage } from '@/components/marketing/StubPage';

export function generateMetadata(): Metadata {
  return pageMetadata('/terms', 'Terms of use');
}

/** Honest stub: the terms do not exist yet. */
export default function TermsPage() {
  return (
    <StubPage eyebrow="Legal" title="Terms of use">
      <p>This document is being prepared and will be published before launch.</p>
    </StubPage>
  );
}
