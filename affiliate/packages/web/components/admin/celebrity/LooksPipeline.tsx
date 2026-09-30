'use client';

/*
 * The looks pipeline. Signed in (the dev token): the live board of
 * celebrity looks, GET /v1/editorial/looks, one column per database status
 * (Draft, In review, Ready, Published, Paused, Withdrawn), each card opening
 * the outfit editor; a card says when an EXACT tag waits for its second
 * person, and "Needs a second person" narrows the board to those looks (the
 * reviewer's queue). Signed out: the existing local board of TEST looks
 * (LooksBoard, lib/console.ts), unchanged.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Checkbox, Tag } from '@/components/ui';
import { getToken } from '@/lib/api';
import { LOOK_COLUMNS, statusLabel, statusTone, type EditorialLookRow } from '@/lib/celebrity-admin';
import { DEMO_EDITORIAL_LOOKS } from '@/lib/demo/celebrity';
import { LooksBoard } from '@/app/admin/looks/LooksBoard';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { useLiveData } from './useLiveData';
import styles from './admin.module.css';

export function LooksPipeline() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => setSignedIn(!!getToken()), []);
  if (signedIn === null) return null;
  return signedIn ? <LiveBoard /> : <LooksBoard />;
}

function LiveBoard() {
  const looks = useLiveData<{ items: EditorialLookRow[] }>('/v1/editorial/looks?page_size=100', DEMO_EDITORIAL_LOOKS, 'the looks');
  const [onlyPending, setOnlyPending] = useState(false);
  const shown = onlyPending ? looks.value.items.filter((l) => (l.pending_exact ?? 0) > 0) : looks.value.items;
  const waiting = looks.value.items.filter((l) => (l.pending_exact ?? 0) > 0).length;
  return (
    <>
      <h1 className="sr-only">Admin: looks pipeline</h1>
      <AdminSection title="Looks pipeline" titleId="admin-looks-title" badge={<LiveBadge demo={looks.demo} cause={looks.cause} />}>
        <LiveBanner notice={looks.notice} />
        <PageNote>
          Celebrity looks from the library, one column per status. Publishing runs the publish gate (rights, licence, pieces, products, EXACT
          reviews, link rules); a takedown moves a look to Withdrawn. Open a look to edit its moment and its outfit, piece by piece.
        </PageNote>
        <div className={styles.gapTop2}>
          <Checkbox checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)}>
            Needs a second person ({waiting} {waiting === 1 ? 'look' : 'looks'} with an EXACT tag to approve)
          </Checkbox>
        </div>
        <div className={styles.board}>
          {LOOK_COLUMNS.map((col) => {
            const inCol = shown.filter((l) => l.status === col.id);
            return (
              <section key={col.id} className={styles.column} aria-label={col.label}>
                <h2 className={styles.columnTitle}>
                  <span>{col.label}</span>
                  <span className="sr-only">: </span>
                  <span>
                    {inCol.length}
                    <span className="sr-only"> {inCol.length === 1 ? 'look' : 'looks'}</span>
                  </span>
                </h2>
                {inCol.map((l) => (
                  <Link key={l.id} href={`/admin/looks/${l.id}`} className={styles.card}>
                    <div className={styles.cardTitle}>{l.celebrity.name}</div>
                    <div className={styles.muted}>
                      {[l.event, l.moment_date].filter(Boolean).join(' · ') || l.title}
                    </div>
                    <div className={styles.gapTop1}>
                      <Tag variant={statusTone(l.celebrity.rights_status)}>{statusLabel(l.celebrity.rights_status)}</Tag>
                      {(l.pending_exact ?? 0) > 0 ? (
                        <>
                          {' '}
                          <Tag variant="outline">
                            {l.pending_exact} EXACT to approve
                          </Tag>
                        </>
                      ) : null}
                      {l.takedown_id ? <span className={styles.error}> · takedown</span> : null}
                    </div>
                    {l.library_ref ? <div className={styles.mono}>{l.library_ref}</div> : null}
                  </Link>
                ))}
                {inCol.length === 0 ? <p className={styles.muted}>None</p> : null}
              </section>
            );
          })}
        </div>
      </AdminSection>
    </>
  );
}
