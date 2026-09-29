import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BrandShell } from './BrandShell';

/** TEST demo pages without a sign-in: kept out of search indexes (noindex, nofollow). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Brand / advertiser workspace (2b). BrandShell reads ?workspace= (an agency
 * working in a client's workspace, 3e) and picks the account and switcher.
 */
export default function BrandLayout({ children }: { children: ReactNode }) {
  return <BrandShell>{children}</BrandShell>;
}
