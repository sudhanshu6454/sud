import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CREATOR_NAV, CREATOR_TABS } from '@/components/shell/areas';
import { DEMO_CREATOR } from '@/lib/demo/afflino';

/** Creator / publisher app (1c). The account is TEST demo data until sign-in is wired. */
export default function CreatorLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={CREATOR_NAV}
      tabs={CREATOR_TABS}
      navLabel="Creator"
      homeHref="/app"
      settingsHref="/app/settings"
      account={{ name: DEMO_CREATOR.name, meta: DEMO_CREATOR.shellMeta, demo: true }}
    >
      {children}
    </AppShell>
  );
}
