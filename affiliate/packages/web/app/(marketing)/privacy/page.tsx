import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { StubPage } from '@/components/marketing/StubPage';

export function generateMetadata(): Metadata {
  return pageMetadata('/privacy', 'Privacy notice');
}

/** Honest stub: the privacy notice does not exist yet. */
export default function PrivacyPage() {
  return (
    <StubPage eyebrow="Legal" title="Privacy notice">
      <p>This document is being prepared and will be published before launch.</p>
    </StubPage>
  );
}
