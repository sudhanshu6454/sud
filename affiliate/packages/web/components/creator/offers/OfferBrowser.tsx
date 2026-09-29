'use client';

/*
 * Offer browser — design 1d (desktop) and 3f left (phone, ≤760px).
 *
 * TEST demo offers (lib/demo/links.ts): v1 has no endpoint for the Afflino
 * offer model (payout, model, category, platforms). GET /v1/offers is the
 * catalogue's product price feed (variant price, merchant, raw offer_url),
 * which this screen must not pull into the browser. So the page renders
 * <DemoBadge variant="mock" />.
 *
 * Search (brand, category, model), category tags (single choice; "All"
 * clears) and "Sort" (lib/links.ts sortOffers: highest payout by estimated
 * rupees per conversion, lowest payout, brand A–Z) work over the demo list.
 * Offers that need brand approval show "Apply" (a demo dialog) instead of
 * "Get link"; once applied, the cell shows "Review".
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, EmptyState, Input, PageHeader, StatusTag, Tag, TagButton } from '@/components/ui';
import { DEMO_OFFER_CATEGORIES, platformList } from '@/lib/demo/afflino';
import { CATEGORY_SHORT, type DemoLinkOffer } from '@/lib/demo/links';
import { formatPayout } from '@/lib/format';
import { filterOffers, OFFER_SORTS, sortOffers, type OfferSort } from '@/lib/links';
import { ApplyDialog } from './ApplyDialog';
import { useDemoApplications } from './applications';
import styles from './OfferBrowser.module.css';

export interface OfferBrowserProps {
  offers: ReadonlyArray<DemoLinkOffer>;
  /** Network-wide live offer count for the header ("128 live offers"). */
  liveCount: number;
}

export function OfferBrowser({ offers, liveCount }: OfferBrowserProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<OfferSort>('payout-desc');
  const [applyFor, setApplyFor] = useState<DemoLinkOffer | null>(null);
  const { hasApplied } = useDemoApplications();

  const visible = useMemo(() => sortOffers(filterOffers(offers, { query, category }), sort), [offers, query, category, sort]);
  const categories = useMemo(
    () => DEMO_OFFER_CATEGORIES.filter((c) => offers.some((o) => o.category === c)),
    [offers],
  );

  const reset = () => {
    setQuery('');
    setCategory(null);
  };

  const trimmed = query.trim();

  const search = (placeholder: string, className: string | undefined) => (
    <span className={className}>
      <Input
        type="search"
        compact
        aria-label="Search offers"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </span>
  );

  return (
    <>
      <div className={styles.desk}>
        <PageHeader
          eyebrow="Offers"
        title={`${liveCount} live offers`}
        actions={
          <>
            <DemoBadge variant="mock" className={styles.badge} />
            {search('Search brands, categories', styles.search)}
          </>
        }
      />
      </div>

      <header className={styles.phoneHeader}>
        <div className={styles.phoneTitleRow}>
          <h1 className={styles.phoneTitle}>Offers</h1>
          <DemoBadge variant="mock" className={styles.badge} />
        </div>
        {search(`Search ${liveCount} offers`, styles.phoneSearch)}
      </header>

      <div className={styles.filters}>
        <div className={styles.tags} role="group" aria-label="Filter by category">
          <TagButton selected={category === null} onClick={() => setCategory(null)} className={styles.tag}>
            All
          </TagButton>
          {categories.map((c) => (
            <TagButton
              key={c}
              selected={category === c}
              onClick={() => setCategory(category === c ? null : c)}
              className={styles.tag}
            >
              {CATEGORY_SHORT[c] ? (
                <>
                  <span className={styles.long}>{c}</span>
                  <span className={styles.short}>{CATEGORY_SHORT[c]}</span>
                </>
              ) : (
                c
              )}
            </TagButton>
          ))}
        </div>
        <label className={styles.sort}>
          Sort:{' '}
          <select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value as OfferSort)}>
            {OFFER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length === offers.length
          ? `${visible.length} demo offers`
          : `${visible.length} of ${offers.length} demo offers shown`}
      </p>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <EmptyState title="No offers match." action={{ label: 'Clear search', onClick: reset }}>
            {trimmed ? `Nothing in the demo list matches “${trimmed}”` : 'Nothing in the demo list matches'}
            {category ? ` in ${category}` : ''}. Try a brand or a category, such as Fintech.
          </EmptyState>
        </div>
      ) : (
        <>
          <ul className={styles.grid} aria-label="Offers">
            {visible.map((offer) => {
              const needsApply = offer.requiresApproval && !hasApplied(offer.id);
              const inReview = offer.requiresApproval && hasApplied(offer.id);
              return (
                <li key={offer.id} className={styles.cell}>
                  <div className={styles.cellHead}>
                    <span className={styles.kicker}>{offer.category}</span>
                    <span className={styles.cellTags}>
                      {inReview ? <StatusTag status="Review" /> : null}
                      <Tag variant={offer.modelTag}>{offer.model}</Tag>
                    </span>
                  </div>
                  <h2 className={styles.cellTitle}>{offer.name}</h2>
                  <p className={styles.cellBody}>{offer.description}</p>
                  <div className={styles.payRow}>
                    <div>
                      <div className={styles.payLabel}>Payout</div>
                      <div className={styles.payValue}>{formatPayout(offer.payout)}</div>
                    </div>
                    <div className={styles.platforms}>
                      <span className="sr-only">Platforms: </span>
                      {platformList(offer.platforms)}
                    </div>
                  </div>
                  {needsApply ? (
                    <Button
                      block
                      arrow
                      className={styles.cta}
                      aria-label={`Apply to promote ${offer.name}`}
                      onClick={() => setApplyFor(offer)}
                    >
                      Apply
                    </Button>
                  ) : (
                    <Button block arrow className={styles.cta} href={`/app/offers/${offer.id}`} aria-label={`Get link for ${offer.name}`}>
                      Get link
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          <ul className={styles.list} aria-label="Offers">
            {visible.map((offer) => {
              const needsApply = offer.requiresApproval && !hasApplied(offer.id);
              const inReview = offer.requiresApproval && hasApplied(offer.id);
              return (
                <li key={offer.id}>
                  <Link href={`/app/offers/${offer.id}`} className={styles.row}>
                    <span className={styles.rowText}>
                      <span className={styles.rowName}>{offer.name}</span>
                      <span className={styles.rowMeta}>
                        {offer.category} · {offer.model}
                        {needsApply ? ' · Apply to promote' : inReview ? ' · In review' : ''}
                      </span>
                    </span>
                    <span className={styles.rowPay}>{formatPayout(offer.payout)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ApplyDialog offer={applyFor} open={applyFor !== null} onClose={() => setApplyFor(null)} />
    </>
  );
}
