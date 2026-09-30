'use client';

import DemoBadge from '@/components/DemoBadge';
import { FallbackBanner } from '@/components/FallbackBanner';
import type { DemoCause } from './useLiveData';
import type { FallbackNotice } from '@/lib/api';

/** The demo badge of a screen: "API unreachable" only when it was; signed out → the plain "Demo data". */
export function LiveBadge({ demo, cause }: { demo: boolean; cause: DemoCause }) {
  if (!demo) return null;
  return <DemoBadge variant={cause === 'unreachable' ? 'fallback' : 'mock'} />;
}

/** The Banner for an answer the API gave (401 → sign in, 403 → the role), as every live admin page shows it. */
export function LiveBanner({ notice }: { notice: FallbackNotice | null }) {
  return <FallbackBanner notice={notice} />;
}
