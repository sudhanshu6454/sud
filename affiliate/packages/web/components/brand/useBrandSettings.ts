'use client';

/*
 * Brand company details, kept in this browser per workspace (no v1 endpoint
 * serves brand profiles). The offer builder reads the website from here to
 * enforce the landing-page domain.
 */

import { DEMO_BRAND_PROFILE, DEMO_BRAND_DOMAIN } from '@/lib/demo/brand';
import { allowedDomain, type BrandSettingsForm } from './settingsModel';
import { STORAGE_KEYS, usePartition } from './storage';
import type { BrandWorkspace } from './workspace';

export function defaultSettings(ws: Pick<BrandWorkspace, 'workspace' | 'name' | 'category'>): BrandSettingsForm {
  if (!ws.workspace) return { ...DEMO_BRAND_PROFILE };
  return {
    ...DEMO_BRAND_PROFILE,
    legalName: `${ws.name} Private Limited`,
    displayName: ws.name,
    category: ws.category,
  };
}

export function useBrandSettings(ws: BrandWorkspace) {
  const initial = defaultSettings(ws);
  const { value, ready, update } = usePartition<BrandSettingsForm>(STORAGE_KEYS.settings, ws.key, initial);
  const settings = { ...initial, ...value };
  return {
    ready,
    settings,
    domain: allowedDomain(settings) || DEMO_BRAND_DOMAIN,
    save: (next: BrandSettingsForm) => update(next),
  };
}
