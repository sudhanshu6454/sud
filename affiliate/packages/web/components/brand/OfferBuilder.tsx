'use client';

/*
 * Offer builder — 3b. Four steps (01 Basics as drawn, 02 Payout, 03 Audience
 * & rules, 04 Creative kit) switch the form section; the right column is the
 * live creator preview with the reach estimate and the fee note.
 *
 * No v1 endpoint exists for brand offers: this is a TEST demo. "Save draft"
 * and "Submit for review" store the offer in this browser (useBrandOffers),
 * where /brand/offers lists it; nothing reaches the API or the admin queue,
 * and the page says so. The form starts from the drawn example unless a
 * stored draft is opened (?draft=<id>) or an offer is duplicated
 * (?duplicate=<id>).
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import DemoBadge from '@/components/DemoBadge';
import {
  Banner,
  Button,
  Eyebrow,
  Field,
  Input,
  PageHeader,
  Segmented,
  Select,
  StatusTag,
  TagButton,
  Textarea,
  cx,
} from '@/components/ui';
import { PLATFORM_NAME, platformList, type OfferModel, type Platform } from '@/lib/demo/afflino';
import { DEMO_BRAND_OFFERS, DEMO_OFFER_DRAFT, DEMO_REACH_MILLIONS, type BrandOfferStatus } from '@/lib/demo/brand';
import { formatCount, formatINRFromMinor } from '@/lib/format';
import { CREATOR_DISCLOSURE_LINE, VALIDATION_WINDOW_OPTIONS_DAYS } from '@/lib/site-copy';
import { OfferPreviewCard } from './OfferPreviewCard';
import {
  DEFAULT_UNIT,
  INDIA_SHARE_OPTIONS,
  MIN_FOLLOWER_OPTIONS,
  OFFER_MODELS,
  OFFER_PLATFORMS,
  OFFER_STEPS,
  UNIT_OPTIONS,
  blankOffer,
  costBreakdown,
  errorsByStep,
  estimateReach,
  FIELD_STEP,
  firstError,
  formatBps,
  formatReach,
  networkFeePct,
  parsePercentToBps,
  parseRupeesToMinor,
  payoutLabel,
  rowToForm,
  validateDraft,
  validateOffer,
  type CreatorApproval,
  type IndiaShare,
  type MinFollowers,
  type OfferErrors,
  type OfferField,
  type OfferForm,
  type OfferStep,
} from './offerModel';
import { useBrandOffers } from './useBrandOffers';
import { useBrandSettings } from './useBrandSettings';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './OfferBuilder.module.css';

/** The plan the demo brand is on (sidebar: "Network plan"). */
const PLAN = 'network' as const;

function drawnExample(): OfferForm {
  return {
    ...blankOffer(),
    name: DEMO_OFFER_DRAFT.name,
    model: DEMO_OFFER_DRAFT.model,
    payout: DEMO_OFFER_DRAFT.payout,
    unit: DEMO_OFFER_DRAFT.unit,
    event: DEMO_OFFER_DRAFT.event,
    budget: DEMO_OFFER_DRAFT.budget,
    platforms: [...DEMO_OFFER_DRAFT.platforms],
    validationDays: DEMO_OFFER_DRAFT.validationDays,
    brief: DEMO_OFFER_DRAFT.brief,
    landingPage: DEMO_OFFER_DRAFT.landingPage,
  };
}

/** Paise shown only when there are some (₹14.40, ₹180). */
function money(minor: number): string {
  return formatINRFromMinor(minor, { paise: minor % 100 !== 0 });
}

/** "₹2500000" / "2500000" → "₹25,00,000" when it parses; unchanged otherwise. */
function tidyRupees(value: string): string {
  const p = parseRupeesToMinor(value);
  return p.ok && value.trim() !== '' ? money(p.value) : value;
}

function tidyPercent(value: string): string {
  const p = parsePercentToBps(value);
  return p.ok && value.trim() !== '' ? formatBps(p.value) : value;
}

const FIELD_ID: Record<OfferField, string> = {
  name: 'offer-name',
  model: 'offer-model',
  payout: 'offer-payout',
  event: 'offer-event',
  budget: 'offer-budget',
  platforms: 'offer-platforms',
  validationDays: 'offer-window',
  brief: 'offer-brief',
  unit: 'offer-unit',
  averageOrderValue: 'offer-aov',
  approval: 'offer-approval',
  minFollowers: 'offer-min-followers',
  indiaShare: 'offer-india',
  rules: 'offer-rules',
  landingPage: 'offer-landing',
  promoCode: 'offer-promo',
  assetsUrl: 'offer-assets',
};

/** Focus a field, or the first control inside a group. */
function focusField(field: OfferField) {
  const id = FIELD_ID[field];
  // A group (Segmented) carries no id of its own: find it by the label that names it.
  const el = document.getElementById(id) ?? document.querySelector<HTMLElement>(`[aria-labelledby~="${id}-label"]`);
  if (!el) return;
  const target =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el
      : el.querySelector<HTMLElement>('input:checked, button, input, select, textarea');
  target?.focus();
}

type Phase = { kind: 'editing' } | { kind: 'submitted'; id: string };

export function OfferBuilder() {
  const ws = useBrandWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const offers = useBrandOffers(ws.key);
  const { settings, domain } = useBrandSettings(ws);

  const [form, setForm] = useState<OfferForm>(drawnExample);
  const [recordId, setRecordId] = useState<string | undefined>(undefined);
  const [origin, setOrigin] = useState<{ status: BrandOfferStatus; reason?: string } | null>(null);
  const [step, setStep] = useState<OfferStep>('basics');
  const [attempted, setAttempted] = useState(false);
  const [draftErrors, setDraftErrors] = useState<OfferErrors>({});
  const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const loadedFor = useRef<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const confirmRef = useRef<HTMLHeadingElement>(null);

  // Open a stored draft (?draft=) or copy an offer (?duplicate=) once the store is read.
  const draftParam = params?.get('draft') ?? null;
  const duplicateParam = params?.get('duplicate') ?? null;
  useEffect(() => {
    if (!offers.ready) return;
    const key = `${ws.key}|${draftParam}|${duplicateParam}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const sourceId = draftParam ?? duplicateParam;
    if (!sourceId) return;
    const local = offers.getLocal(sourceId);
    const seed = DEMO_BRAND_OFFERS.find((o) => o.id === sourceId);
    const row = offers.rows.find((r) => r.id === sourceId);
    const loaded = local ? { ...blankOffer(), ...local.form } : seed ? rowToForm(seed) : null;
    if (!loaded) {
      setNotice('That draft is not stored in this browser, so the builder starts from the example offer.');
      return;
    }
    if (duplicateParam) {
      setForm({ ...loaded, name: `Copy of ${loaded.name}`.slice(0, 80) });
      setRecordId(undefined);
      setOrigin(null);
    } else {
      setForm(loaded);
      setRecordId(sourceId);
      const status = row?.status ?? local?.status ?? 'Draft';
      setOrigin({ status, reason: row?.rejectionReason });
    }
  }, [offers.ready, offers, draftParam, duplicateParam, ws.key]);

  const ctx = useMemo(() => ({ allowedDomain: domain }), [domain]);
  const errors: OfferErrors = attempted ? validateOffer(form, ctx) : draftErrors;
  const stepErrors = errorsByStep(attempted ? errors : {});
  const errorCount = Object.keys(attempted ? errors : {}).length;

  const set = <K extends OfferField>(key: K, value: OfferForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'name') setDraftErrors({});
  };

  const setModel = (model: OfferModel) => {
    setForm((prev) => {
      const wasPercent = prev.model === 'CPS';
      const isPercent = model === 'CPS';
      return {
        ...prev,
        model,
        payout: wasPercent === isPercent ? prev.payout : '',
        unit: prev.unit === DEFAULT_UNIT[prev.model] ? DEFAULT_UNIT[model] : prev.unit,
      };
    });
  };

  const togglePlatform = (p: Platform) => {
    setForm((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(p)
        ? prev.platforms.filter((x) => x !== p)
        : OFFER_PLATFORMS.filter((x) => x === p || prev.platforms.includes(x)),
    }));
  };

  const goToStep = (next: OfferStep, focusTab = false) => {
    setStep(next);
    if (focusTab) tabRefs.current[OFFER_STEPS.findIndex((s) => s.id === next)]?.focus();
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = OFFER_STEPS.length - 1;
    let target: number | null = null;
    if (event.key === 'ArrowRight') target = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') target = index === 0 ? last : index - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = last;
    if (target === null) return;
    event.preventDefault();
    goToStep(OFFER_STEPS[target]!.id, true);
  };

  const saveDraft = () => {
    const e = validateDraft(form);
    if (Object.keys(e).length > 0) {
      setAttempted(false);
      setDraftErrors(e);
      setStep('basics');
      requestAnimationFrame(() => focusField('name'));
      return;
    }
    setDraftErrors({});
    const id = offers.save(form, 'Draft', recordId);
    setRecordId(id);
    setOrigin({ status: 'Draft' });
    const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date());
    setNotice(`Draft saved at ${time}, in this browser only (demo).`);
    router.replace(ws.href(`/brand/offers/new?draft=${encodeURIComponent(id)}`), { scroll: false });
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    setAttempted(true);
    const e = validateOffer(form, ctx);
    const first = firstError(e);
    if (first) {
      setNotice('');
      setStep(FIELD_STEP[first]);
      requestAnimationFrame(() => focusField(first));
      return;
    }
    const id = offers.save(form, 'In review', recordId);
    setRecordId(id);
    setNotice('');
    setPhase({ kind: 'submitted', id });
  };

  useEffect(() => {
    if (phase.kind === 'submitted') confirmRef.current?.focus();
  }, [phase]);

  const startBlank = () => {
    setForm(blankOffer());
    setRecordId(undefined);
    setOrigin(null);
    setAttempted(false);
    setDraftErrors({});
    setNotice('');
    setStep('basics');
    setPhase({ kind: 'editing' });
    router.replace(ws.href('/brand/offers/new'), { scroll: false });
    requestAnimationFrame(() => focusField('name'));
  };

  /* ---------- preview ---------- */
  const reach = estimateReach(form.platforms, DEMO_REACH_MILLIONS);
  const feePct = networkFeePct(PLAN);
  const previewPayout = payoutLabel(form);
  const offerName = form.name.trim() || 'New offer';

  const stepIndex = OFFER_STEPS.findIndex((s) => s.id === step);
  const activeStep = OFFER_STEPS[stepIndex]!;
  const nextStep = OFFER_STEPS[stepIndex + 1];
  const prevStep = OFFER_STEPS[stepIndex - 1];

  const eyebrowAction =
    phase.kind === 'submitted'
      ? 'Offer submitted'
      : recordId
        ? origin?.status === 'Rejected'
          ? 'Edit offer'
          : 'Edit draft'
        : 'New offer';

  return (
    <>
      <PageHeader
        eyebrow={`${ws.name} · ${eyebrowAction}`}
        title={offerName}
        actions={
          <>
            <DemoBadge variant="mock" className={shared.badge} />
            {phase.kind === 'submitted' ? null : (
              <>
                <Button variant="ghost" onClick={saveDraft} className={styles.headerButton}>
                  Save draft
                </Button>
                <Button variant="primary" arrow type="submit" form="offer-form" className={styles.headerButton}>
                  Submit for review
                </Button>
              </>
            )}
          </>
        }
      />

      <div role="status" aria-live="polite" className={notice ? styles.infoBar : shared.noticeEmpty}>
        {notice}
      </div>
      {attempted && errorCount > 0 && phase.kind === 'editing' ? (
        <Banner title={`Fix ${errorCount === 1 ? '1 field' : `${errorCount} fields`} before submitting.`}>
          {OFFER_STEPS.filter((s) => stepErrors[s.id] > 0)
            .map((s) => `${s.number} ${s.label}: ${stepErrors[s.id]}`)
            .join(' · ')}
        </Banner>
      ) : null}
      {origin?.status === 'Rejected' && origin.reason && phase.kind === 'editing' ? (
        <Banner title="Rejected in review.">{origin.reason} Fix it and submit again.</Banner>
      ) : null}

      {phase.kind === 'submitted' ? (
        <div className={styles.layout}>
          <section className={styles.confirm} aria-labelledby="offer-submitted">
            <StatusTag status="In review" />
            <h2 id="offer-submitted" ref={confirmRef} tabIndex={-1} className={styles.confirmTitle}>
              Submitted for review
            </h2>
            <p className={styles.confirmCopy}>
              {offerName} is now <strong>In review</strong>. Afflino reviews every new offer before creators can see it;
              once approved it goes Live and appears in the offer browser.
            </p>
            <p className={shared.demoNote}>
              Demo: the offer is stored in this browser only. No review request was sent, and no brand-offer API
              exists yet.
            </p>
            <div className={styles.confirmActions}>
              <Button variant="primary" arrow href={ws.href('/brand/offers')}>
                View offers
              </Button>
              <Button variant="secondary" onClick={startBlank}>
                Create another offer
              </Button>
            </div>
          </section>
          <Preview
            category={settings.category}
            brand={settings.displayName}
            form={form}
            payout={previewPayout}
            reach={reach}
            feePct={feePct}
          />
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Offer steps" className={styles.tabs}>
            {OFFER_STEPS.map((s, i) => {
              const selected = s.id === step;
              const count = stepErrors[s.id];
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`offer-tab-${s.id}`}
                  aria-selected={selected}
                  aria-controls="offer-form"
                  tabIndex={selected ? 0 : -1}
                  className={cx(styles.tab, selected && styles.tabActive)}
                  onClick={() => goToStep(s.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                >
                  {s.number} {s.label}
                  {count > 0 ? <span className={styles.tabErrors}> · {count} to fix</span> : null}
                </button>
              );
            })}
          </div>

          <div className={styles.layout}>
            <form
              id="offer-form"
              role="tabpanel"
              aria-labelledby={`offer-tab-${step}`}
              className={styles.form}
              onSubmit={submit}
              noValidate
            >
              {step === 'basics' ? (
                <BasicsStep form={form} errors={errors} set={set} setModel={setModel} togglePlatform={togglePlatform} />
              ) : null}
              {step === 'payout' ? <PayoutStep form={form} errors={errors} set={set} feePct={feePct} /> : null}
              {step === 'audience' ? <AudienceStep form={form} errors={errors} set={set} /> : null}
              {step === 'creative' ? <CreativeStep form={form} errors={errors} set={set} domain={domain} /> : null}

              <div className={styles.footer}>
                <div className={styles.footerNav}>
                  {prevStep ? (
                    <Button variant="ghost" arrow="left" onClick={() => goToStep(prevStep.id)} className={styles.footerButton}>
                      {prevStep.number} {prevStep.label}
                    </Button>
                  ) : null}
                  {nextStep ? (
                    <Button variant="secondary" arrow onClick={() => goToStep(nextStep.id)} className={styles.footerButton}>
                      Next: {nextStep.number} {nextStep.label}
                    </Button>
                  ) : (
                    <Button variant="primary" arrow type="submit" className={styles.footerButton}>
                      Submit for review
                    </Button>
                  )}
                </div>
                <Button variant="ghost" onClick={startBlank} className={styles.footerButton}>
                  Start from a blank form
                </Button>
              </div>
              <p className={cx(shared.demoNote, styles.formNote)}>
                Step {activeStep.number} of 04. Demo: drafts and submissions are kept in this browser; nothing is sent
                to Afflino.
              </p>
            </form>

            <Preview
              category={settings.category}
              brand={settings.displayName}
              form={form}
              payout={previewPayout}
              reach={reach}
              feePct={feePct}
            />
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ preview column */

function Preview({
  category,
  brand,
  form,
  payout,
  reach,
  feePct,
}: {
  category: string;
  brand: string;
  form: OfferForm;
  payout: string | null;
  reach: [number, number] | null;
  feePct: number;
}) {
  return (
    <aside className={styles.preview} aria-labelledby="offer-preview-label">
      <Eyebrow as="h2" id="offer-preview-label">
        Preview — how creators see it
      </Eyebrow>
      <div aria-live="polite" aria-atomic="false">
        <OfferPreviewCard
          category={category}
          model={form.model}
          title={`${brand} · ${form.name.trim() || 'New offer'}`}
          description={form.event}
          payout={payout}
          platforms={platformList(OFFER_PLATFORMS.filter((p) => form.platforms.includes(p)))}
        />
      </div>
      <p className={styles.previewNote}>
        {reach
          ? `Estimated reach at this payout: ${formatReach(reach)} across matched creators.`
          : 'Choose at least one platform to estimate reach.'}{' '}
        Network fee {feePct}% is billed on approved conversions.
      </p>
    </aside>
  );
}

/* ------------------------------------------------------------ steps */

type SetField = <K extends OfferField>(key: K, value: OfferForm[K]) => void;

interface StepProps {
  form: OfferForm;
  errors: OfferErrors;
  set: SetField;
}

function Wide({ children }: { children: ReactNode }) {
  return <div className={styles.wide}>{children}</div>;
}

function BasicsStep({
  form,
  errors,
  set,
  setModel,
  togglePlatform,
}: StepProps & { setModel: (m: OfferModel) => void; togglePlatform: (p: Platform) => void }) {
  const percent = form.model === 'CPS';
  return (
    <>
      <Wide>
        <Field label="Offer name" id={FIELD_ID.name} error={errors.name} required>
          <Input value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
        </Field>
      </Wide>
      <Field label="Model" id={FIELD_ID.model} error={errors.model}>
        <Segmented
          block
          className={styles.seg}
          options={OFFER_MODELS.map((m) => ({ value: m, label: m }))}
          value={form.model}
          onChange={setModel}
        />
      </Field>
      <Field
        label="Payout per conversion"
        id={FIELD_ID.payout}
        error={errors.payout}
        hint={percent ? '% of the order value.' : undefined}
        required
      >
        <Input
          value={form.payout}
          inputMode="decimal"
          placeholder={percent ? '12%' : '₹180'}
          onChange={(e) => set('payout', e.target.value)}
          onBlur={(e) => set('payout', percent ? tidyPercent(e.target.value) : tidyRupees(e.target.value))}
          autoComplete="off"
        />
      </Field>
      <Field label="Conversion event" id={FIELD_ID.event} error={errors.event} required>
        <Input
          value={form.event}
          maxLength={140}
          placeholder="Sign-up + first transaction"
          onChange={(e) => set('event', e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field label="Budget cap" id={FIELD_ID.budget} error={errors.budget} required>
        <Input
          value={form.budget}
          inputMode="decimal"
          placeholder="₹25,00,000"
          onChange={(e) => set('budget', e.target.value)}
          onBlur={(e) => set('budget', tidyRupees(e.target.value))}
          autoComplete="off"
        />
      </Field>
      <Field label="Allowed platforms" id={FIELD_ID.platforms} error={errors.platforms} group>
        <div className={styles.platformTags} id={FIELD_ID.platforms} role="group" aria-labelledby={`${FIELD_ID.platforms}-label`}>
          {OFFER_PLATFORMS.map((p) => {
            const on = form.platforms.includes(p);
            return (
              <TagButton
                key={p}
                selected={on}
                className={styles.platformTag}
                onClick={() => togglePlatform(p)}
                aria-describedby={errors.platforms ? `${FIELD_ID.platforms}-msg` : undefined}
              >
                <span>
                  {PLATFORM_NAME[p]}
                  {on ? <span aria-hidden="true"> ✓</span> : null}
                </span>
              </TagButton>
            );
          })}
        </div>
      </Field>
      <Field label="Validation window" id={FIELD_ID.validationDays} error={errors.validationDays}>
        <Segmented
          block
          className={styles.seg}
          options={VALIDATION_WINDOW_OPTIONS_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))}
          value={String(form.validationDays)}
          onChange={(v) => set('validationDays', Number(v))}
        />
      </Field>
      <Wide>
        <Field label="Brief for creators" id={FIELD_ID.brief} error={errors.brief} required>
          <Textarea value={form.brief} maxLength={1000} onChange={(e) => set('brief', e.target.value)} />
        </Field>
      </Wide>
    </>
  );
}

function PayoutStep({ form, errors, set, feePct }: StepProps & { feePct: number }) {
  const breakdown = costBreakdown(form, PLAN);
  const label = payoutLabel(form);
  const percent = form.model === 'CPS';
  const budget = parseRupeesToMinor(form.budget);
  const units = UNIT_OPTIONS.includes(form.unit) ? UNIT_OPTIONS : [form.unit, ...UNIT_OPTIONS];
  const rows: Array<[string, string]> = [
    ['Model', form.model],
    ['Payout', label ?? '—'],
  ];
  if (percent) rows.push(['Payout per sale at that order value', breakdown ? money(breakdown.payoutMinor) : '—']);
  rows.push(
    [`Network fee (${feePct}%, Network plan)`, breakdown ? money(breakdown.feeMinor) : '—'],
    ['Cost per approved conversion', breakdown ? money(breakdown.costMinor) : '—'],
    ['Budget cap', budget.ok && budget.value > 0 ? money(budget.value) : '—'],
    [
      'Approved conversions the cap pays for',
      breakdown?.conversionsInBudget !== null && breakdown?.conversionsInBudget !== undefined
        ? formatCount(breakdown.conversionsInBudget)
        : '—',
    ],
    ['Network fee if the cap is paid out', breakdown?.feeAtCapMinor != null ? money(breakdown.feeAtCapMinor) : '—'],
    ['Validation window', `${form.validationDays} days`],
  );
  return (
    <>
      <Field
        label="Counted per"
        id={FIELD_ID.unit}
        error={errors.unit}
        hint={label ? `Creators see “${label}”.` : 'The word after the payout, e.g. “/ sign-up”.'}
      >
        <Select value={form.unit} onChange={(e) => set('unit', e.target.value)} options={units.map((u) => ({ value: u, label: u }))} />
      </Field>
      {percent ? (
        <Field
          label="Average order value"
          labelSuffix="(optional)"
          id={FIELD_ID.averageOrderValue}
          error={errors.averageOrderValue}
          hint="Only used for the estimates below."
        >
          <Input
            value={form.averageOrderValue}
            inputMode="decimal"
            placeholder="₹1,500"
            onChange={(e) => set('averageOrderValue', e.target.value)}
            onBlur={(e) => set('averageOrderValue', tidyRupees(e.target.value))}
            autoComplete="off"
          />
        </Field>
      ) : (
        <div />
      )}
      <Wide>
        <table className={styles.breakdown}>
          <caption className={styles.breakdownCaption}>What one approved conversion costs</caption>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Wide>
      <Wide>
        <p className={styles.stepNote}>
          The budget cap counts creator payouts; the {feePct}% network fee is billed on top, on approved conversions
          only. Conversions are approved or rejected within the {form.validationDays}-day validation window; rejected
          ones cost nothing.
          {percent && !breakdown ? ' Add an average order value to see the cost of one sale.' : ''} Change the payout,
          budget or window in 01 Basics.
        </p>
      </Wide>
    </>
  );
}

function AudienceStep({ form, errors, set }: StepProps) {
  return (
    <>
      <Wide>
        <Field
          label="Creator approval"
          id={FIELD_ID.approval}
          error={errors.approval}
          hint={
            form.approval === 'manual'
              ? 'Creators see “Apply” instead of “Get link”; you approve each one on the Creators page.'
              : 'Any creator who matches the rules below can get a link straight away.'
          }
        >
          <Segmented
            block
            className={styles.seg}
            options={[
              { value: 'auto' as CreatorApproval, label: 'Open to matching creators' },
              { value: 'manual' as CreatorApproval, label: 'I approve each creator' },
            ]}
            value={form.approval}
            onChange={(v) => set('approval', v)}
          />
        </Field>
      </Wide>
      <Field label="Minimum audience" id={FIELD_ID.minFollowers} error={errors.minFollowers}>
        <Select
          value={form.minFollowers}
          onChange={(e) => set('minFollowers', e.target.value as MinFollowers)}
          options={MIN_FOLLOWER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Field>
      <Field label="Audience in India" id={FIELD_ID.indiaShare} error={errors.indiaShare}>
        <Select
          value={form.indiaShare}
          onChange={(e) => set('indiaShare', e.target.value as IndiaShare)}
          options={INDIA_SHARE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Field>
      <Wide>
        <Field
          label="Rules for creators"
          labelSuffix="(optional)"
          id={FIELD_ID.rules}
          error={errors.rules}
          hint="Shown with the brief. Allowed platforms are set in 01 Basics."
        >
          <Textarea
            value={form.rules}
            maxLength={600}
            placeholder="e.g. No paid search ads on the brand name. No coupon-site listings."
            onChange={(e) => set('rules', e.target.value)}
          />
        </Field>
      </Wide>
    </>
  );
}

function CreativeStep({ form, errors, set, domain }: StepProps & { domain: string }) {
  return (
    <>
      <Wide>
        <Field
          label="Landing page"
          id={FIELD_ID.landingPage}
          error={errors.landingPage}
          hint={`Must be on ${domain}, your website in Settings. Creators never see this address: they share their tracked link.`}
          required
        >
          <Input
            value={form.landingPage}
            type="url"
            inputMode="url"
            placeholder={`https://${domain}/…`}
            onChange={(e) => set('landingPage', e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </Wide>
      <Field
        label="Promo code"
        labelSuffix="(optional)"
        id={FIELD_ID.promoCode}
        error={errors.promoCode}
        hint="4–15 letters or digits."
      >
        <Input
          value={form.promoCode}
          maxLength={15}
          onChange={(e) => set('promoCode', e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          mono
        />
      </Field>
      <Field
        label="Creative assets"
        labelSuffix="(optional)"
        id={FIELD_ID.assetsUrl}
        error={errors.assetsUrl}
        hint="An https:// link to logos, product shots and approved captions."
      >
        <Input
          value={form.assetsUrl}
          type="url"
          inputMode="url"
          onChange={(e) => set('assetsUrl', e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Wide>
        <div className={styles.disclosure}>
          <Eyebrow>Disclosure</Eyebrow>
          <p className={styles.stepNote}>
            Creators are offered this line with every link they copy, and must disclose the paid relationship in the
            post itself:
          </p>
          <p className={styles.disclosureLine}>{CREATOR_DISCLOSURE_LINE}</p>
          <p className={shared.demoNote}>Draft wording, pending legal review.</p>
        </div>
      </Wide>
    </>
  );
}
