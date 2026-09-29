import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { AGENCY_NAV, AGENCY_TABS } from '@/components/shell/areas';
import { DEMO_AGENCY, DEMO_AGENCY_CLIENTS } from '@/lib/demo/afflino';

/**
 * Agency workspace (3e). The switcher moves into a client brand's workspace
 * (the brand UI, 2b, at /brand?workspace=<client id>; app/brand/BrandShell
 * reads it and offers the way back here). There is no agency settings screen,
 * so the phone account box is shown, not linked. The account is TEST demo
 * data until sign-in is wired.
 */
export default function AgencyLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      nav={AGENCY_NAV}
      tabs={AGENCY_TABS}
      navLabel="Agency"
      homeHref="/agency"
      account={{ name: DEMO_AGENCY.name, meta: DEMO_AGENCY.shellMeta, demo: true }}
      switcher={
        <WorkspaceSwitcher
          current={DEMO_AGENCY.name}
          options={DEMO_AGENCY_CLIENTS.map((c) => ({
            label: c.name,
            meta: `${c.category} · ${c.creators} creators`,
            href: `/brand?workspace=${encodeURIComponent(c.id)}`,
          }))}
        />
      }
    >
      {children}
    </AppShell>
  );
}
