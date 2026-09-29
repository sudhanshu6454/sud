import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Onboarding } from '@/components/onboarding/Onboarding';

/** A sign-up flow with demo steps: kept out of search indexes. */
export const metadata: Metadata = { title: 'Join', robots: { index: false, follow: false } };

/**
 * Sign-up & onboarding (2a, 3a): three steps in the accent-panel shell, no
 * marketing chrome. ?role=creator|publisher|brand|agency preselects the
 * account type; ?step= is the current step (components/onboarding).
 */
export default function JoinPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
