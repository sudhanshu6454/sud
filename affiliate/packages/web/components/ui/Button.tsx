import Link from 'next/link';
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from './cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'inverse';
export type ButtonSize = 'xs' | 'sm' | 'md';

interface ButtonOwnProps {
  /** primary = accent fill; secondary = 1px divider border; ghost = accent text; inverse = ground fill on an accent field. Default secondary. */
  variant?: ButtonVariant;
  /** md (default, 14px, 8×14.4 padding); sm (13px, 8×14 — list-row actions); xs (13px, 6×12 — table-row actions). */
  size?: ButtonSize;
  /** Full width with the label flush left (the handover's .btn-block, incl. its 8px top margin). */
  block?: boolean;
  /** With block: drop the 8px top margin. */
  flush?: boolean;
  /** Append " →" (true / 'right') or prepend "← " ('left'); hidden from assistive technology. */
  arrow?: boolean | 'right' | 'left';
  /** min-height 44px (mobile hit area). */
  touch?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonAsButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps> & { href?: undefined };

export type ButtonAsLinkProps = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps | 'href'> & {
    /** Renders a Next <Link>. */
    href: string;
    /** A link cannot be disabled; this renders an inert <a aria-disabled> with no href. */
    disabled?: boolean;
    prefetch?: boolean;
    replace?: boolean;
    scroll?: boolean;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function content(children: ReactNode, arrow: ButtonOwnProps['arrow']) {
  if (!arrow) return children;
  // One inline run, so the arrow sits a word-space from the label exactly as
  // in the mocks ("Get a link →"), not the flex gap.
  return (
    <span>
      {arrow === 'left' && <span aria-hidden="true">← </span>}
      {children}
      {arrow !== 'left' && <span aria-hidden="true"> →</span>}
    </span>
  );
}

/**
 * Button (and button-styled link when `href` is given). Hover/active/focus/
 * disabled states per the handover: primary → accent-600 / accent-700,
 * secondary → 7% / 14% ink tint, ghost → 10% / 18% accent tint, focus-visible
 * 2px accent outline (global), disabled 45% opacity.
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(
  props,
  ref,
) {
  const {
    variant = 'secondary',
    size = 'md',
    block = false,
    flush = false,
    arrow,
    touch = false,
    className,
    children,
    ...rest
  } = props;

  const classes = cx(
    styles.btn,
    styles[size],
    styles[variant],
    block && styles.block,
    block && flush && styles.flush,
    touch && styles.touch,
    className,
  );

  if (typeof rest.href === 'string') {
    const { href, disabled, prefetch, replace, scroll, ...anchor } = rest as ButtonAsLinkProps;
    if (disabled) {
      return (
        <a ref={ref as Ref<HTMLAnchorElement>} className={classes} aria-disabled="true" {...anchor}>
          {content(children, arrow)}
        </a>
      );
    }
    return (
      <Link
        ref={ref as Ref<HTMLAnchorElement>}
        href={href}
        prefetch={prefetch}
        replace={replace}
        scroll={scroll}
        className={classes}
        {...anchor}
      >
        {content(children, arrow)}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- href is undefined here; keep it off <button>
  const { type = 'button', href: _href, ...button } = rest as ButtonAsButtonProps;
  return (
    <button ref={ref as Ref<HTMLButtonElement>} type={type} className={classes} {...button}>
      {content(children, arrow)}
    </button>
  );
});
