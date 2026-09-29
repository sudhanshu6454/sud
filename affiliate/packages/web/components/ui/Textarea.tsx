'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { useFieldControl } from './Field';
import styles from './Control.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Multi-line input: same box as Input, min-height 96px, line-height 1.5 (3b brief). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  const { invalid: isInvalid, ...wiring } = useFieldControl({ ...rest, invalid });
  return (
    <textarea
      ref={ref}
      {...rest}
      {...wiring}
      className={cx(styles.control, styles.textarea, isInvalid && styles.invalid, className)}
    />
  );
});
