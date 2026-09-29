import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CREATOR_NAV, CREATOR_PHONE_TOPBAR_HIDDEN_ON, CREATOR_TABS } from '@/components/shell/areas';
import { DEMO_CREATOR } from '@/lib/demo/afflino';

/** TEST demo pages without a sign-in: kept out of search indexes (noindex, nofollow). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Creator / publisher app (1c). The account is TEST demo data until sign-in is wired. */
export default function CreatorLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={CREATOR_NAV}
      tabs={CREATOR_TABS}
      navLabel="Creator"
      homeHref="/app"
      settingsHref="/app/settings"
      phoneTopbarHiddenOn={CREATOR_PHONE_TOPBAR_HIDDEN_ON}
      account={{ name: DEMO_CREATOR.name, meta: DEMO_CREATOR.shellMeta, demo: true }}
    >
      {children}
    </AppShell>
  );
}
