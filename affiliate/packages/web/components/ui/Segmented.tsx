'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { cx } from './cx';
import { useFieldContext } from './Field';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string = string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Radio group name; generated when omitted. */
  name?: string;
  /** Accessible name when not inside a <Field> (inside one, the field label names the group). */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Full width with equal options and 10px 12px padding (form fields: 1e, 3a, 3b). Default: inline, 8px 14px (page toolbars: 1c, 2c). */
  block?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Segmented control with radio-group semantics: native radio inputs, so
 * Tab enters the group at the selected option and the arrow keys move the
 * selection (the browser's own radio behaviour).
 */
export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  name,
  block = false,
  disabled = false,
  className,
  ...aria
}: SegmentedProps<T>) {
  const generated = useId();
  const field = useFieldContext();
  const groupName = name ?? `seg${generated.replace(/:/g, '')}`;
  const labelledBy = aria['aria-labelledby'] ?? (aria['aria-label'] ? undefined : field?.labelId);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && field && !field.group) {
      console.error(
        'Segmented sits in a <Field> that renders a <label for>: make it a direct child of the Field or pass <Field group>.',
      );
    }
  }, [field]);

  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      aria-labelledby={labelledBy}
      aria-describedby={field?.describedBy}
      className={cx(styles.seg, block && styles.block, className)}
    >
      {options.map((option) => {
        const checked = option.value === value;
        const optionDisabled = disabled || option.disabled === true;
        return (
          <label
            key={option.value}
            className={cx(styles.opt, checked && styles.selected, optionDisabled && styles.disabled)}
          >
            <input
              type="radio"
              className={styles.input}
              name={groupName}
              value={option.value}
              checked={checked}
              disabled={optionDisabled}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

/** Read by <Field>: the label names this group (aria-labelledby) instead of pointing a <label for> at it. */
Segmented.fieldGroup = true;
