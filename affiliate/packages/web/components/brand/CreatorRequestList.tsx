'use client';

/*
 * Creator requests (2b right column, 3f phone list, /brand/creators): name,
 * reach and Approve (primary) / Decline (ghost on desktop, secondary 44px on
 * phones). A decision removes the row and is announced in a polite live
 * region. TEST demo: no creator is notified.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState, cx } from '@/components/ui';
import type { DemoCreatorRequest } from '@/lib/demo/afflino';
import { emptyRequestsMessage } from './requestsModel';
import { requestReach } from './useCreatorRequests';
import styles from './CreatorRequestList.module.css';

export interface CreatorRequestListProps {
  requests: ReadonlyArray<DemoCreatorRequest>;
  ready: boolean;
  onApprove: (name: string) => void;
  onDecline: (name: string) => void;
  /** desktop = 2b (xs buttons, ghost Decline); phone = 3f (44px, equal width, secondary Decline). */
  variant: 'desktop' | 'phone';
  /** Where the empty state's one action goes. */
  emptyAction?: { label: string; href: string };
  /**
   * Requests still pending in total (the KPI / "Requests · n" figure). When
   * the demo sample is used up but this is above 0, the empty state says the
   * rest are not in the demo data instead of "none waiting".
   */
  pendingCount?: number;
  /** id of the heading that names the list. */
  labelledBy: string;
  className?: string;
}

export function CreatorRequestList({
  requests,
  ready,
  onApprove,
  onDecline,
  variant,
  emptyAction,
  pendingCount = 0,
  labelledBy,
  className,
}: CreatorRequestListProps) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const listRef = useRef<HTMLUListElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  /** Row index to move focus to once a decided row has left the list. */
  const refocus = useRef<number | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Keep keyboard focus in the list: the row that takes the decided row's
  // place (or the new last row); the status line when the list is empty.
  useEffect(() => {
    const index = refocus.current;
    if (index === null) return;
    refocus.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('li button');
    const firsts = buttons ? Array.from(buttons).filter((_, i) => i % 2 === 0) : [];
    const target = firsts[Math.min(index, firsts.length - 1)];
    if (target) target.focus();
    else statusRef.current?.focus();
  }, [requests]);

  const announce = (text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 6000);
  };

  const phone = variant === 'phone';

  return (
    <div className={cx(styles.wrap, phone && styles.phone, className)}>
      <p
        ref={statusRef}
        tabIndex={-1}
        className={cx(styles.status, message === '' && styles.statusEmpty)}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {!ready ? (
        <ul className={styles.list} aria-labelledby={labelledBy} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className={styles.item}>
              <div className={styles.line}>
                <span className={styles.skel} style={{ width: '40%' }} />
                <span className={styles.skel} style={{ width: '22%' }} />
              </div>
              <div className={styles.actions}>
                <span className={cx(styles.skel, styles.skelButton)} />
              </div>
            </li>
          ))}
        </ul>
      ) : requests.length === 0 ? (
        <EmptyState className={styles.empty} action={emptyAction}>
          {emptyRequestsMessage(pendingCount)}
        </EmptyState>
      ) : (
        <ul ref={listRef} className={styles.list} aria-labelledby={labelledBy}>
          {requests.map((r, index) => (
            <li key={r.name} className={styles.item}>
              <div className={styles.line}>
                <span className={styles.name}>{r.name}</span>
                <span className={styles.reach}>{requestReach(r)}</span>
              </div>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  size={phone ? 'md' : 'xs'}
                  touch={phone}
                  className={styles.button}
                  aria-label={`Approve ${r.name}`}
                  onClick={() => {
                    refocus.current = index;
                    onApprove(r.name);
                    announce(`${r.name} approved: they can now promote your offers.`);
                  }}
                >
                  Approve
                </Button>
                <Button
                  variant={phone ? 'secondary' : 'ghost'}
                  size={phone ? 'md' : 'xs'}
                  touch={phone}
                  className={styles.button}
                  aria-label={`Decline ${r.name}`}
                  onClick={() => {
                    refocus.current = index;
                    onDecline(r.name);
                    announce(`${r.name} declined.`);
                  }}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
