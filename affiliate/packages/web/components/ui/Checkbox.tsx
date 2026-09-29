'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { useFieldControl } from './Field';
import styles from './Control.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  /** The label text, 14px / 1.5 (the 3a consent row). */
  children: ReactNode;
  invalid?: boolean;
}

/** Native checkbox, visually a 16px dot with a 2px ink border and accent fill when checked. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { children, invalid, className, ...rest },
  ref,
) {
  const { invalid: isInvalid, ...wiring } = useFieldControl({ ...rest, invalid });
  return (
    <label className={cx(styles.check, isInvalid && styles.checkInvalid, className)}>
      <input ref={ref} type="checkbox" {...rest} {...wiring} className={styles.checkInput} />
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.checkLabel}>{children}</span>
    </label>
  );
});
