'use client';

import { useId, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';
import { useFieldContext } from './Field';
import styles from './SelectableCard.module.css';

export interface SelectableCardOption<T extends string = string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface SelectableCardGroupProps<T extends string = string> {
  options: ReadonlyArray<SelectableCardOption<T>>;
  /** Selected value, or null for none yet. */
  value: T | null;
  onChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Account type". */
  label: string;
  name?: string;
  /** Cells per row. Default 2 (one column below 560px). */
  columns?: number;
  className?: string;
}

/**
 * Grid of selectable cards with radio semantics (native radios: arrow keys
 * move the selection, Tab leaves the group).
 */
export function SelectableCardGroup<T extends string = string>({
  options,
  value,
  onChange,
  label,
  name,
  columns = 2,
  className,
}: SelectableCardGroupProps<T>) {
  const generated = useId();
  const groupName = name ?? `cards${generated.replace(/:/g, '')}`;
  // Inside a <Field>, its label names the group (aria-labelledby wins over aria-label).
  const field = useFieldContext();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={field?.labelId}
      aria-describedby={field?.describedBy}
      className={cx(styles.grid, className)}
      style={{ '--cards-columns': columns } as CSSProperties}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cx(styles.card, checked && styles.selected, option.disabled && styles.disabled)}
          >
            <input
              type="radio"
              className={styles.input}
              name={groupName}
              value={option.value}
              checked={checked}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.title}>{option.title}</span>
            {option.description ? <span className={styles.description}>{option.description}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/** Read by <Field>: render its label as a <span> naming this group. */
SelectableCardGroup.fieldGroup = true;
