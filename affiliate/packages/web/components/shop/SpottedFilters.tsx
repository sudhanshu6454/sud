import { CELEBRITY_WEB } from '../../lib/site-copy';
import type { Facet } from '../../lib/spotted';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import styles from './SpottedFilters.module.css';

/**
 * The feed's filters: one celebrity, one in-house page (a live storefront).
 * A plain GET form on /shop with the design system's selects and a "Show
 * looks" button: the page changes only on submit (WCAG 3.2.2 — arrowing
 * through a select never navigates), it works without JavaScript, and a
 * filter stays a shareable address. The options are the API's facets, i.e.
 * only who and what has public looks right now.
 */
export function SpottedFilters({
  celebrities,
  pages,
  celebrity,
  from,
}: {
  celebrities: ReadonlyArray<Facet>;
  pages: ReadonlyArray<Facet>;
  celebrity: string | null;
  from: string | null;
}) {
  if (celebrities.length === 0 && pages.length === 0) return null;
  return (
    <form method="get" action="/shop" className={styles.filters} aria-label="Filter the looks">
      {celebrities.length > 0 ? (
        <label className={styles.filter}>
          <span className={styles.label}>{CELEBRITY_WEB.filterCelebrity}</span>
          <Select compact name="celebrity" defaultValue={celebrity ?? ''} className={styles.select}>
            <option value="">{CELEBRITY_WEB.filterAll}</option>
            {celebrities.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} ({c.looks})
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      {pages.length > 0 ? (
        <label className={styles.filter}>
          <span className={styles.label}>{CELEBRITY_WEB.filterPage}</span>
          <Select compact name="from" defaultValue={from ?? ''} className={styles.select}>
            <option value="">{CELEBRITY_WEB.filterAll}</option>
            {pages.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name} ({p.looks})
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <Button type="submit" variant="secondary" size="sm" touch className={styles.submit}>
        {CELEBRITY_WEB.showLooks}
      </Button>
    </form>
  );
}
