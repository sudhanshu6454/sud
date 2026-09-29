'use client';

/*
 * The 2e review-queue table (Type tag · Subject · Reason · Age · Action) and
 * its filter tags. A decided row shows its status tag and "View" instead of
 * "Review". Used by /admin (all types) and by /admin/offers and
 * /admin/fraud (one type).
 */

import { Button, Skeleton, Tag, statusTag, type DataTableColumn, type TagVariant } from '@/components/ui';
import type { AdminReviewItem } from '@/lib/demo/admin';
import { DECISION_LABEL, QUEUE_FILTERS, type Decision, type Decisions, type QueueFilter } from './queueModel';
import { FilterTags } from './FilterTags';
import { ResponsiveTable, StackRow } from './ResponsiveTable';
import styles from './ReviewQueueTable.module.css';

export const DECISION_TAG: Record<Decision, TagVariant> = {
  approved: 'accent',
  rejected: 'neutral',
  info_requested: 'outline',
};

/** Type tag as drawn in 2e: Fraud accent, Offer neutral, KYC outline. */
export function TypeTag({ type }: { type: AdminReviewItem['type'] }) {
  return <Tag variant={statusTag(type)}>{type}</Tag>;
}

export function DecisionTag({ decision }: { decision: Decision }) {
  return <Tag variant={DECISION_TAG[decision]}>{DECISION_LABEL[decision]}</Tag>;
}

export interface QueueFiltersProps {
  value: QueueFilter;
  counts: Record<QueueFilter, number>;
  onChange: (filter: QueueFilter) => void;
  /** Accessible name of the group. */
  label?: string;
}

/** "All · 212", "Offers · 14", "KYC · 76", "Fraud · 122" — toggle tags (aria-pressed). */
export function QueueFilters({ value, counts, onChange, label = 'Filter the review queue' }: QueueFiltersProps) {
  return <FilterTags options={QUEUE_FILTERS} value={value} counts={counts} onChange={onChange} label={label} />;
}

export interface ReviewQueueTableProps {
  items: ReadonlyArray<AdminReviewItem>;
  decisions: Decisions;
  ready: boolean;
  onReview: (item: AdminReviewItem) => void;
  caption: string;
  /** Hide the Type column (a one-type page). */
  hideType?: boolean;
  empty?: string;
}

/** 2e column widths (104 / 433 / 469 / 56 / 154 of 1216px). */
const WIDTHS = { type: '8.55%', subject: '35.6%', reason: '38.57%', age: '4.6%' };

export function ReviewQueueTable({
  items,
  decisions,
  ready,
  onReview,
  caption,
  hideType = false,
  empty = 'Nothing waiting for review.',
}: ReviewQueueTableProps) {
  const action = (item: AdminReviewItem) => {
    if (!ready) return <Skeleton width={74} height={29} inline />;
    const record = decisions[item.id];
    if (!record) {
      return (
        <Button
          size="xs"
          data-review-action={item.id}
          aria-label={`Review: ${item.subject}`}
          className={styles.action}
          onClick={() => onReview(item)}
        >
          Review
        </Button>
      );
    }
    return (
      <span className={styles.decided}>
        <DecisionTag decision={record.decision} />
        <Button
          size="xs"
          variant="ghost"
          data-review-action={item.id}
          aria-label={`View decision: ${item.subject}`}
          className={`${styles.action} ${styles.view}`}
          onClick={() => onReview(item)}
        >
          View
        </Button>
      </span>
    );
  };

  const columns: ReadonlyArray<DataTableColumn<AdminReviewItem>> = [
    ...(hideType ? [] : [{ key: 'type', header: 'Type', width: WIDTHS.type, cell: (r: AdminReviewItem) => <TypeTag type={r.type} /> }]),
    { key: 'subject', header: 'Subject', tone: 'strong', width: hideType ? '40%' : WIDTHS.subject, className: styles.subject, cell: (r) => r.subject },
    { key: 'reason', header: 'Reason', tone: 'body', width: hideType ? '40%' : WIDTHS.reason, cell: (r) => r.reason },
    { key: 'age', header: 'Age', tone: 'muted', width: WIDTHS.age, cell: (r) => r.age },
    { key: 'action', header: 'Action', cell: action },
  ];

  return (
    <ResponsiveTable
      looseHeader
      caption={caption}
      columns={columns}
      rows={items}
      rowKey={(r) => r.id}
      empty={empty}
      className={styles.table}
      phoneRow={(r) => (
        <StackRow
          eyebrow={
            <>
              {hideType ? null : <TypeTag type={r.type} />}
              <span className={styles.age}>{r.age}</span>
            </>
          }
          title={r.subject}
          meta={r.reason}
          actions={action(r)}
        />
      )}
    />
  );
}
