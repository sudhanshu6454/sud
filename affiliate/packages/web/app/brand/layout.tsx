import type { ReactNode } from 'react';
import { BrandShell } from './BrandShell';

/**
 * Brand / advertiser workspace (2b). BrandShell reads ?workspace= (an agency
 * working in a client's workspace, 3e) and picks the account and switcher.
 */
export default function BrandLayout({ children }: { children: ReactNode }) {
  return <BrandShell>{children}</BrandShell>;
}
