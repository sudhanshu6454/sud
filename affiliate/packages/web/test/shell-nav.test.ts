import { describe, expect, it } from 'vitest';
import { BRAND_NAV, BRAND_TABS, navInWorkspace, withWorkspace } from '../components/shell/areas';
import { activeNavIndex } from '../components/shell/nav';

describe('shell nav matching', () => {
  it('keeps the exact / prefix / longest-match rules', () => {
    expect(activeNavIndex(BRAND_NAV, '/brand')).toBe(0);
    expect(activeNavIndex(BRAND_NAV, '/brand/offers/new')).toBe(1);
    expect(activeNavIndex(BRAND_NAV, '/brand/unknown')).toBe(-1);
  });

  it('ignores a ?query on the item href (the agency workspace parameter)', () => {
    const nav = navInWorkspace(BRAND_NAV, 'demo-style');
    expect(nav[1]!.href).toBe('/brand/offers?workspace=demo-style');
    expect(activeNavIndex(nav, '/brand')).toBe(0);
    expect(activeNavIndex(nav, '/brand/offers/new')).toBe(1);
    expect(activeNavIndex(navInWorkspace(BRAND_TABS, 'demo-style'), '/brand/billing')).toBe(3);
  });
});

describe('withWorkspace', () => {
  it('adds the parameter, encoded, before any #fragment', () => {
    expect(withWorkspace('/brand', 'demo-payupi')).toBe('/brand?workspace=demo-payupi');
    expect(withWorkspace('/brand/offers?tab=live', 'a b')).toBe('/brand/offers?tab=live&workspace=a%20b');
    expect(withWorkspace('/brand#top', 'demo-ludo')).toBe('/brand?workspace=demo-ludo#top');
  });

  it('is a no-op without a workspace', () => {
    expect(withWorkspace('/brand', null)).toBe('/brand');
    expect(navInWorkspace(BRAND_NAV, undefined)).toBe(BRAND_NAV);
  });
});
