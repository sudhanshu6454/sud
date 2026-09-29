'use client';

/*
 * Brand settings (not drawn; 2d patterns, README Brand { name, gstin } and
 * the onboarding brand branch: legal name, GSTIN, website, category).
 * Saved to this browser per workspace (no brand-profile endpoint in v1).
 * The website sets the landing-page domain the offer builder enforces. The
 * GSTIN is checked for format only.
 */

import { useEffect, useState, type FormEvent } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, Field, Input, PageHeader, Select } from '@/components/ui';
import { BRAND_CATEGORIES, allowedDomain, normaliseBrandSettings, validateBrandSettings, type BrandSettingsErrors, type BrandSettingsForm } from './settingsModel';
import { useBrandSettings } from './useBrandSettings';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './BrandSettings.module.css';

const IDS: Record<keyof BrandSettingsForm, string> = {
  legalName: 'brand-legal-name',
  displayName: 'brand-display-name',
  gstin: 'brand-gstin',
  website: 'brand-website',
  category: 'brand-category',
  billingEmail: 'brand-billing-email',
};

export function BrandSettings() {
  const ws = useBrandWorkspace();
  const store = useBrandSettings(ws);
  const [form, setForm] = useState<BrandSettingsForm>(store.settings);
  const [errors, setErrors] = useState<BrandSettingsErrors>({});
  const [notice, setNotice] = useState('');

  // Load the stored values once they have been read from the browser.
  const storedJson = JSON.stringify(store.settings);
  useEffect(() => {
    if (store.ready) setForm(JSON.parse(storedJson) as BrandSettingsForm);
  }, [store.ready, storedJson]);

  const set = (key: keyof BrandSettingsForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    setNotice('');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const e = validateBrandSettings(form);
    const first = (Object.keys(IDS) as Array<keyof BrandSettingsForm>).find((k) => e[k]);
    setErrors(e);
    if (first) {
      setNotice('');
      document.getElementById(IDS[first])?.focus();
      return;
    }
    const next = normaliseBrandSettings(form);
    store.save(next);
    setForm(next);
    setNotice(`Saved in this browser (demo). Landing pages must now be on ${allowedDomain(next)}.`);
  };

  const onCancel = () => {
    setForm(store.settings);
    setErrors({});
    setNotice('Changes discarded.');
  };

  return (
    <>
      <PageHeader
        eyebrow={`${ws.name} · Settings`}
        title="Company details"
        actions={<DemoBadge variant="mock" className={shared.badge} />}
      />
      <form className={styles.form} onSubmit={onSubmit} noValidate aria-label="Company details">
        <div className={styles.grid}>
          <Field label="Company legal name" id={IDS.legalName} error={errors.legalName} hint="As on the company’s GST or PAN records." required>
            <Input value={form.legalName} maxLength={120} autoComplete="organization" onChange={(e) => set('legalName', e.target.value)} />
          </Field>
          <Field label="Brand name" id={IDS.displayName} error={errors.displayName} hint="What creators see on your offers." required>
            <Input value={form.displayName} maxLength={60} onChange={(e) => set('displayName', e.target.value)} />
          </Field>
          <Field
            label="GSTIN"
            labelSuffix="(optional)"
            id={IDS.gstin}
            error={errors.gstin}
            hint="Printed on your invoices. Checked for format only, not verified with the GST network."
          >
            <Input
              value={form.gstin}
              maxLength={15}
              mono
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set('gstin', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Website" id={IDS.website} error={errors.website} hint="Offer landing pages must be on this domain." required>
            <Input
              value={form.website}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              onChange={(e) => set('website', e.target.value)}
            />
          </Field>
          <Field label="Category" id={IDS.category} error={errors.category} hint="The kicker on your offer cards." required>
            <Select value={form.category} onChange={(e) => set('category', e.target.value)} options={BRAND_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Billing email" id={IDS.billingEmail} error={errors.billingEmail} hint="Invoices and wallet receipts go here." required>
            <Input value={form.billingEmail} type="email" autoComplete="email" onChange={(e) => set('billingEmail', e.target.value)} />
          </Field>
        </div>
        <div className={styles.footer}>
          <p role="status" aria-live="polite" className={notice ? shared.notice : shared.noticeEmpty}>
            {notice}
          </p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={onCancel} className={styles.touch}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" className={styles.touch}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
