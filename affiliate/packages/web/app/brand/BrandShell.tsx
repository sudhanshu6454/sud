'use client';

import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell, type ShellAccount } from '@/components/shell/AppShell';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';
import { BRAND_NAV, BRAND_TABS, navInWorkspace, withWorkspace } from '@/components/shell/areas';
import { DEMO_AGENCY, DEMO_AGENCY_CLIENTS, DEMO_BRAND } from '@/lib/demo/afflino';

/**
 * The brand workspace frame. Signed in as a brand it is the 2b shell with the
 * brand's own account. Opened by an agency (3e: /brand?workspace=<client id>)
 * it is the same UI for that client, with a workspace switcher in the
 * sidebar (the agency's other clients and "Back to agency") and every nav
 * link carrying the parameter so the agency stays in the workspace. An
 * unknown id falls back to the brand's own shell. All accounts are TEST demo
 * data until sign-in is wired.
 */
export function BrandShell({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const requested = params?.get('workspace') ?? null;
  const client = requested ? DEMO_AGENCY_CLIENTS.find((c) => c.id === requested) : undefined;
  const workspace = client ? client.id : null;

  const account: ShellAccount = client
    ? {
        name: client.name,
        // No spend here: the workspace's pages print the shared TEST figures
        // (ASSUMPTIONS 60), and a second, different spend beside them would
        // contradict the KPI strip.
        meta: `${client.category} · agency client`,
        demo: true,
      }
    : { name: DEMO_BRAND.name, meta: DEMO_BRAND.shellMeta, demo: true };

  const switcher = client ? (
    <WorkspaceSwitcher
      current={client.name}
      options={[
        ...DEMO_AGENCY_CLIENTS.filter((c) => c.id !== client.id).map((c) => ({
          label: c.name,
          meta: `${c.category} · ${c.creators} creators`,
          href: withWorkspace('/brand', c.id),
        })),
        { label: 'Back to agency', meta: DEMO_AGENCY.name, href: '/agency' },
      ]}
    />
  ) : undefined;

  return (
    <AppShell
      nav={navInWorkspace(BRAND_NAV, workspace)}
      tabs={navInWorkspace(BRAND_TABS, workspace)}
      navLabel="Brand"
      homeHref={withWorkspace('/brand', workspace)}
      settingsHref={withWorkspace('/brand/settings', workspace)}
      account={account}
      switcher={switcher}
    >
      {children}
    </AppShell>
  );
}
