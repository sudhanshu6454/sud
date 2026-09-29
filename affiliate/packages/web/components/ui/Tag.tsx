import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Tag.module.css';

export type TagVariant = 'accent' | 'neutral' | 'outline' | 'ink';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** accent (accent-100 / accent-800), neutral (neutral-100 / neutral-800), outline (1px accent), ink (selected, ink fill). Default neutral. */
  variant?: TagVariant;
  children: ReactNode;
}

export function Tag({ variant = 'neutral', className, children, ...rest }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[variant], className)} {...rest}>
      {children}
    </span>
  );
}

export interface TagButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Pressed state (aria-pressed). */
  selected: boolean;
  /** Look when selected. Default accent (the "All" filter in 1d / 2e / 3f). */
  selectedVariant?: TagVariant;
  /** Look when not selected. Default outline. */
  unselectedVariant?: TagVariant;
  children: ReactNode;
}

/**
 * A filter or toggle tag (1d category filters, 2e queue filters, 3b allowed
 * platforms). Renders a <button aria-pressed>.
 */
export function TagButton({
  selected,
  selectedVariant = 'accent',
  unselectedVariant = 'outline',
  className,
  type = 'button',
  children,
  ...rest
}: TagButtonProps) {
  const variant = selected ? selectedVariant : unselectedVariant;
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(styles.tag, styles.button, styles[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Status → tag variant, per the handover: Active / Paid / Connected / Live →
 * accent; Paused / Offer / Draft / Ended → neutral; Review / In review /
 * Scheduled / KYC / Pending → outline; Fraud / Flagged → accent. Anything
 * else is neutral. Case-insensitive.
 */
export function statusTag(status: string): TagVariant {
  switch (status.trim().toLowerCase()) {
    case 'active':
    case 'paid':
    case 'connected':
    case 'live':
    case 'approved':
    case 'fraud':
    case 'flagged':
      return 'accent';
    case 'review':
    case 'in review':
    case 'scheduled':
    case 'kyc':
    case 'pending':
      return 'outline';
    case 'paused':
    case 'offer':
    case 'draft':
    case 'ended':
    default:
      return 'neutral';
  }
}

/** <Tag> whose variant comes from statusTag(status). */
export function StatusTag({ status, className }: { status: string; className?: string }) {
  return (
    <Tag variant={statusTag(status)} className={className}>
      {status}
    </Tag>
  );
}
