'use client';

import { TagButton } from '@/components/ui';
import { formatCount } from '@/lib/format';
import styles from './ReviewQueueTable.module.css';

export interface FilterTagsProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  counts: Readonly<Record<T, number>>;
  onChange: (value: T) => void;
  /** Accessible name of the group ("Filter brands"). */
  label: string;
}

/** A row of toggle tags "Label · count" (2e's queue filters); the selected one is accent, the rest outline. */
export function FilterTags<T extends string>({ options, value, counts, onChange, label }: FilterTagsProps<T>) {
  return (
    <div role="group" aria-label={label} className={styles.filters}>
      {options.map((o) => (
        <TagButton key={o.value} selected={value === o.value} className={styles.filterTag} onClick={() => onChange(o.value)}>
          {`${o.label} · ${formatCount(counts[o.value])}`}
        </TagButton>
      ))}
    </div>
  );
}
