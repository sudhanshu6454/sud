import Link from 'next/link';
import { Banner } from './ui/Banner';
import type { FallbackNotice } from '@/lib/api';

/**
 * The top Banner for a live call that answered but gave the page no live
 * data (lib/api.ts fallbackNotice: 401 → sign in again, 403 → the role
 * cannot read it, 404, 400, 5xx; lib/earnings.ts: no publisher id, another
 * publisher). An unreachable API has no Banner: the "API unreachable"
 * badge says it.
 */
export function FallbackBanner({ notice, className }: { notice: FallbackNotice | null | undefined; className?: string }) {
  if (!notice) return null;
  return (
    <Banner title={notice.title} className={className}>
      {notice.message}
      {notice.action ? (
        <>
          {' '}
          <Link href={notice.action.href}>
            {notice.action.label}
            <span aria-hidden="true"> →</span>
          </Link>
        </>
      ) : null}
    </Banner>
  );
}
