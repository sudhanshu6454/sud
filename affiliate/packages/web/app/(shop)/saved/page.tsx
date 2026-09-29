'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import DemoBadge from '@/components/DemoBadge';
import { DisclosureLine } from '@/components/shop/DisclosureLine';
import { isDemoLookId } from '@/components/shop/model';
import { notifySavedChange, SAVED_CHANGE_EVENT } from '@/components/shop/savedEvents';
import shared from '@/components/shop/detail.module.css';
import { Button, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { itemHref, readSaved, removeSaved, SAVED_KEY, type SavedItem } from '@/lib/saved';
import styles from './page.module.css';

const keyOf = (s: Pick<SavedItem, 'lookId' | 'itemId'>) => `${s.lookId}:${s.itemId}`;

/**
 * Wishlist. Entries live in localStorage (`saved-items`) with the look id,
 * item id and display data captured when saved; the price shown is the one
 * at save time, so the page says so and links back to the live item page.
 * Skeleton rows until the browser has read the list; "Nothing saved yet"
 * with "Browse the shop →" when it is empty. Entries saved from the TEST
 * demo catalogue (non-uuid look ids) put the Demo data badge on the page.
 */
export default function SavedPage() {
  const [saved, setSaved] = useState<SavedItem[] | null>(null);
  const [message, setMessage] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => setSaved(readSaved());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_KEY) load();
    };
    load();
    window.addEventListener(SAVED_CHANGE_EVENT, load);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SAVED_CHANGE_EVENT, load);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // After a removal, keep keyboard focus in the list (the next row's Remove,
  // else the previous one), or on the empty state's action when none is left.
  useEffect(() => {
    if (focusKey === null) return;
    if (focusKey === '') emptyRef.current?.querySelector<HTMLElement>('a')?.focus();
    else removeRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, saved]);

  const remove = (entry: SavedItem) => {
    const list = saved ?? [];
    const index = list.findIndex((s) => keyOf(s) === keyOf(entry));
    const next = removeSaved(entry.lookId, entry.itemId);
    setSaved(next);
    notifySavedChange();
    setMessage(`${entry.brand} — ${entry.model} removed from saved.`);
    const neighbour = list[index + 1] ?? list[index - 1];
    setFocusKey(neighbour ? keyOf(neighbour) : '');
  };

  const demo = saved?.some((s) => isDemoLookId(s.lookId)) ?? false;
  const count = saved?.length ?? 0;

  return (
    <>
      <PageHeader
        className={shared.header}
        eyebrow="Shop the looks"
        title={saved === null || count === 0 ? 'Saved' : `${count} saved ${count === 1 ? 'product' : 'products'}`}
        description={
          count > 0 ? 'Prices are as of when you saved them — open the product for the current offer.' : undefined
        }
        actions={demo ? <DemoBadge variant="mock" className={shared.badge} /> : undefined}
      />

      <div className={styles.body}>
        {saved === null ? (
          <ul className={styles.list} aria-busy="true" aria-label="Loading saved products">
            {[0, 1, 2].map((i) => (
              <li key={i} className={styles.row}>
                <span className={styles.main}>
                  <Skeleton width="60%" height={18} />
                  <Skeleton width="35%" height={13} />
                </span>
                <span className={styles.price}>
                  <Skeleton width={72} height={18} />
                </span>
                <span />
              </li>
            ))}
          </ul>
        ) : count === 0 ? (
          <div ref={emptyRef} className={styles.empty}>
            <EmptyState title="Nothing saved yet." action={{ label: 'Browse the shop', href: '/shop' }}>
              Tap “Save” on any product to keep it here for later.
            </EmptyState>
          </div>
        ) : (
          <ul className={styles.list} aria-label="Saved products">
            {saved.map((s) => (
              <li key={keyOf(s)} className={styles.row}>
                <span className={styles.main}>
                  <Link href={itemHref(s.lookId, s.itemId)} className={styles.name}>
                    {s.brand} — {s.model}
                  </Link>
                  <span className={styles.meta}>From the look {s.lookTitle}</span>
                </span>
                <span className={styles.price}>
                  {s.price_minor !== null && s.currency ? (
                    <span className={styles.amount}>{formatMoney(s.price_minor, s.currency)}</span>
                  ) : (
                    <span className={styles.meta}>No live offer when saved</span>
                  )}
                  {s.merchant ? <span className={styles.meta}>at {s.merchant}</span> : null}
                </span>
                <span className={styles.action}>
                  <Button
                    ref={(el) => {
                      if (el instanceof HTMLButtonElement) removeRefs.current.set(keyOf(s), el);
                      else removeRefs.current.delete(keyOf(s));
                    }}
                    variant="ghost"
                    size="xs"
                    className={styles.remove}
                    onClick={() => remove(s)}
                    aria-label={`Remove ${s.brand} — ${s.model} from saved`}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="sr-only" aria-live="polite">
          {message}
        </p>
      </div>

      <DisclosureLine />
    </>
  );
}
