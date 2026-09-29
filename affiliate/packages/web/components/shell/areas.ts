/**
 * Navigation for each signed-in area. Layouts pass these to <AppShell>; the
 * section root is 'exact' so it is not active on its sub-routes.
 */
import type { NavItem } from './nav';

export const CREATOR_NAV: ReadonlyArray<NavItem> = [
  { label: 'Overview', href: '/app', match: 'exact' },
  { label: 'Offers', href: '/app/offers' },
  { label: 'My links', href: '/app/links' },
  { label: 'Reports', href: '/app/reports' },
  { label: 'Payouts', href: '/app/payouts' },
  { label: 'Settings', href: '/app/settings' },
];

export const CREATOR_TABS: ReadonlyArray<NavItem> = [
  { label: 'Home', href: '/app', match: 'exact' },
  { label: 'Offers', href: '/app/offers' },
  { label: 'Links', href: '/app/links' },
  { label: 'Payouts', href: '/app/payouts' },
];

export const BRAND_NAV: ReadonlyArray<NavItem> = [
  { label: 'Overview', href: '/brand', match: 'exact' },
  { label: 'Offers', href: '/brand/offers' },
  { label: 'Creators', href: '/brand/creators' },
  { label: 'Conversions', href: '/brand/conversions' },
  { label: 'Billing', href: '/brand/billing' },
  { label: 'Settings', href: '/brand/settings' },
];

export const BRAND_TABS: ReadonlyArray<NavItem> = [
  { label: 'Home', href: '/brand', match: 'exact' },
  { label: 'Offers', href: '/brand/offers' },
  { label: 'Creators', href: '/brand/creators' },
  { label: 'Billing', href: '/brand/billing' },
];

/**
 * The agency area is one screen (3e) with two sections; the sidebar links
 * to them by fragment. Brand work happens in the brand workspace (the
 * switcher, /brand?workspace=<client id>). There is no agency settings
 * screen in the design or the route map, so the phone account box is not a
 * link.
 */
export const AGENCY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Workspace', href: '/agency', match: 'exact' },
  { label: 'Brand clients', href: '/agency#clients' },
  { label: 'Roster', href: '/agency#roster' },
];

export const AGENCY_TABS: ReadonlyArray<NavItem> = [
  { label: 'Workspace', href: '/agency', match: 'exact' },
  { label: 'Clients', href: '/agency#clients' },
  { label: 'Roster', href: '/agency#roster' },
];

/**
 * The brand workspace an agency opened (/brand?workspace=<client id>). Brand
 * nav stays inside it: every brand href carries the parameter.
 */
export function withWorkspace(href: string, workspace: string | null | undefined): string {
  if (!workspace) return href;
  const hashAt = href.indexOf('#');
  const base = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : href.slice(hashAt);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}workspace=${encodeURIComponent(workspace)}${hash}`;
}

export function navInWorkspace(items: ReadonlyArray<NavItem>, workspace: string | null | undefined): ReadonlyArray<NavItem> {
  return workspace ? items.map((item) => ({ ...item, href: withWorkspace(item.href, workspace) })) : items;
}
