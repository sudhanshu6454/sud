'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from './cx';
import { useFieldControl } from './Field';
import styles from './Control.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 10px 12px padding — search / filter inputs in page headers (1d, 3c, 3f). */
  compact?: boolean;
  /** Monospace text (links, sub-IDs). */
  mono?: boolean;
  /** Accent border; set automatically inside a <Field error>. */
  invalid?: boolean;
}

/** Text input: 2px ink border, ground fill, 12px padding, 14px (as drawn). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { compact = false, mono = false, invalid, className, type = 'text', ...rest },
  ref,
) {
  const { invalid: isInvalid, ...wiring } = useFieldControl({ ...rest, invalid });
  return (
    <input
      ref={ref}
      type={type}
      {...rest}
      {...wiring}
      className={cx(
        styles.control,
        compact && styles.compact,
        mono && styles.mono,
        isInvalid && styles.invalid,
        className,
      )}
    />
  );
});
