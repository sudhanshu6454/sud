'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import { useFieldControl } from './Field';
import styles from './Control.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Shorthand for <option> children. */
  options?: SelectOption[];
  /** First, empty option (value ""), e.g. "Choose an offer". */
  placeholder?: string;
  compact?: boolean;
  invalid?: boolean;
}

/** Native <select> in the Input box, with a small ink chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, compact = false, invalid, className, children, ...rest },
  ref,
) {
  const { invalid: isInvalid, ...wiring } = useFieldControl({ ...rest, invalid });
  return (
    <select
      ref={ref}
      {...rest}
      {...wiring}
      className={cx(styles.control, styles.select, compact && styles.compact, isInvalid && styles.invalid, className)}
    >
      {placeholder !== undefined ? (
        <option value="" disabled={rest.required}>
          {placeholder}
        </option>
      ) : null}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
});
