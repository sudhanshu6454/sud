import Link from 'next/link';
import type { ReactNode } from 'react';
import DemoBadge from '../DemoBadge';
import Disclosure from '../Disclosure';
import { CELEBRITY_WEB } from '../../lib/site-copy';
import { momentDate, pieceCount, platformLabel, type CelebrityLook, type PieceProduct } from '../../lib/spotted';
import { PageHeader } from '../ui/PageHeader';
import { Tag } from '../ui/Tag';
import { BackBar } from './BackBar';
import { CelebrityCredit } from './CelebrityCredit';
import { CommercialLabel } from './CommercialLabel';
import { Facts } from './Facts';
import { OutfitPieces } from './OutfitPieces';
import { StillWithHotspots } from './StillWithHotspots';
import { lookDisclosures } from './model';
import detail from './detail.module.css';
import styles from './CelebrityLookView.module.css';

/** Every product of the look, EXACT ones first (for the disclosure panel's statements, once each). */
function products(look: CelebrityLook): PieceProduct[] {
  return look.pieces.flatMap((p) => [...(p.exact ? [p.exact] : []), ...p.similar]);
}

/**
 * A celebrity look (the paparazzi moment) piece by piece: the commercial
 * label first (only on a page that carries products); the headline the API
 * composed ("Spotted at <event>": never the name, which a display headline
 * would set far larger than the non-endorsement line) with the credit line
 * under it — the name and the non-endorsement line in one sentence at body
 * size (CCPA 2022 cl.11: the same type size); on phones a numbered index of
 * the pieces; the still (only when allowed; otherwise no media region at
 * all) with its numbered markers in its own region, apart from every
 * product (the brief's B5; Amazon PR 11: no Amazon content near or on the
 * still); the moment's facts and "View the original post"; then the outfit,
 * piece by piece, under the affiliate disclosure.
 */
export function CelebrityLookView({ look, demo }: { look: CelebrityLook; demo: boolean }) {
  const all = products(look);
  const { disclosures, attributions } = lookDisclosures(all);
  const date = momentDate(look.moment.date);
  const platform = platformLabel(look.platform);
  const facts: [string, ReactNode][] = [];
  if (look.moment.event) facts.push(['Moment', look.moment.event]);
  if (look.moment.place) facts.push(['Place', look.moment.place]);
  if (date) facts.push(['Date', date]);
  if (look.storefront) facts.push([CELEBRITY_WEB.fromPage, <Link key="sf" href={`/s/${look.storefront.slug}`}>{look.storefront.name}</Link>]);
  else if (platform) facts.push([CELEBRITY_WEB.fromPage, `Our ${platform} page`]);
  facts.push(['Outfit', pieceCount(look.pieces.length)]);
  facts.push(['Affiliate links', look.display.shoppable && all.length > 0 ? 'Yes (we earn from qualifying purchases)' : 'No products on this page']);

  return (
    <>
      {look.commercialLabel ? <CommercialLabel text={look.commercialLabel} /> : null}
      <BackBar href="/shop" label={CELEBRITY_WEB.feedTitle} title="Look" />
      <PageHeader
        className={detail.header}
        eyebrow={
          <>
            <span className={detail.crumbDesk}>
              <Link href="/shop" className={detail.crumb}>
                {CELEBRITY_WEB.feedTitle}
              </Link>
              {date ? ' · ' : null}
            </span>
            {date ?? <span className={detail.crumbDesk}>Look</span>}
          </>
        }
        title={look.headline}
        description={<CelebrityCredit celebrity={look.celebrity} nonEndorsement={look.nonEndorsement} as="span" />}
        actions={
          look.disclosure.sponsored || demo ? (
            <span className={detail.headerActions}>
              {look.disclosure.sponsored ? <Tag variant="accent">Sponsored</Tag> : null}
              {demo ? <DemoBadge className={detail.badge} /> : null}
            </span>
          ) : undefined
        }
      />

      {look.pieces.length > 1 ? (
        <nav className={styles.index} aria-label={CELEBRITY_WEB.piecesIndex}>
          <ol className={styles.indexList}>
            {look.pieces.map((p, i) => (
              <li key={p.id}>
                <a href={`#piece-${p.id}`} className={styles.indexLink}>
                  <span className={styles.indexNumber} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="sr-only">{i + 1}. </span>
                  {p.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className={detail.split}>
        <div className={detail.media}>
          {look.image ? (
            <div className={detail.cover}>
              <StillWithHotspots look={look} className={styles.still} />
            </div>
          ) : null}
          <div className={detail.aside}>
            <Facts label="About this moment" items={facts} />
            {look.postPermalink ? (
              <p className={styles.original}>
                <a href={look.postPermalink} rel="noopener nofollow" className={styles.originalLink}>
                  {CELEBRITY_WEB.originalPost}
                  <span aria-hidden="true">{'\u00a0'}→</span>
                </a>
              </p>
            ) : null}
          </div>
        </div>

        <section className={detail.body} aria-labelledby="look-outfit">
          <div className={detail.sectionHead}>
            <h2 id="look-outfit" className={detail.sectionTitle}>
              {CELEBRITY_WEB.outfitTitle}
            </h2>
          </div>
          {look.display.shoppable && all.length > 0 ? <Disclosure lines={disclosures} /> : null}
          <OutfitPieces pieces={look.pieces} headingId="look-outfit" />
          {attributions.map((a) => (
            <p key={a} className={detail.note}>
              {a}
            </p>
          ))}
        </section>
      </div>
    </>
  );
}
