/**
 * Brand settings (company details) — pure validation, relative imports only.
 * Shape checks only: a GSTIN that passes here is not verified against the GST
 * network, and nothing here proves the brand owns the website.
 */

import { DEMO_OFFER_CATEGORIES } from '../../lib/demo/afflino';
import { validateGstin } from '../../lib/validators';
import { domainOf } from './offerModel';

export interface BrandSettingsForm {
  legalName: string;
  displayName: string;
  gstin: string;
  website: string;
  category: string;
  billingEmail: string;
}

export type BrandSettingsErrors = Partial<Record<keyof BrandSettingsForm, string>>;

export const BRAND_CATEGORIES: ReadonlyArray<string> = [...DEMO_OFFER_CATEGORIES, 'Other'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateBrandSettings(form: BrandSettingsForm): BrandSettingsErrors {
  const e: BrandSettingsErrors = {};
  const legal = form.legalName.trim();
  if (legal === '') e.legalName = 'Enter the company’s legal name, as on its GST or PAN records.';
  else if (legal.length > 120) e.legalName = 'Keep the legal name to 120 characters.';

  const display = form.displayName.trim();
  if (display === '') e.displayName = 'Enter the brand name creators will see.';
  else if (display.length > 60) e.displayName = 'Keep the brand name to 60 characters.';

  const gst = validateGstin(form.gstin);
  if (!gst.ok) e.gstin = gst.message;

  const site = form.website.trim();
  if (site === '') e.website = 'Enter the brand’s website: offer landing pages must be on it.';
  else {
    let url: URL | null = null;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(site) ? site : `https://${site}`);
    } catch {
      url = null;
    }
    if (!url || !url.hostname.includes('.')) e.website = 'Enter a web address, e.g. https://shop.example.com';
    else if (url.protocol !== 'https:') e.website = 'Use an https:// address.';
  }

  if (!BRAND_CATEGORIES.includes(form.category)) e.category = 'Choose a category.';

  const email = form.billingEmail.trim();
  if (email === '') e.billingEmail = 'Enter where invoices should go.';
  else if (!EMAIL_RE.test(email)) e.billingEmail = 'Enter an email address, e.g. billing@example.com';

  return e;
}

/** The normalised values to store (trimmed, GSTIN upper-cased, website with https://). */
export function normaliseBrandSettings(form: BrandSettingsForm): BrandSettingsForm {
  const site = form.website.trim();
  return {
    legalName: form.legalName.trim(),
    displayName: form.displayName.trim(),
    gstin: form.gstin.trim().toUpperCase(),
    website: site && !/^[a-z]+:\/\//i.test(site) ? `https://${site}` : site,
    category: form.category,
    billingEmail: form.billingEmail.trim(),
  };
}

/** The form differs from what is saved (after normalising both): Save is enabled only then, as on 2d. */
export function brandSettingsDirty(form: BrandSettingsForm, saved: BrandSettingsForm): boolean {
  return JSON.stringify(normaliseBrandSettings(form)) !== JSON.stringify(normaliseBrandSettings(saved));
}

/** The landing-page domain the offer builder enforces. */
export function allowedDomain(settings: Pick<BrandSettingsForm, 'website'>): string {
  return domainOf(settings.website);
}
