'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import styles from './Dialog.module.css';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export interface DialogProps {
  open: boolean;
  /** Called on Esc, on a backdrop click (unless dismissOnBackdrop is false) and by your own close buttons. */
  onClose: () => void;
  title: ReactNode;
  /** Body copy (14px). */
  children?: ReactNode;
  /** Buttons, right-aligned (e.g. Cancel ghost + Confirm primary). */
  actions?: ReactNode;
  /** Element to focus on open; default the first focusable element in the dialog. */
  initialFocusRef?: RefObject<HTMLElement>;
  dismissOnBackdrop?: boolean;
  /** 640px instead of 440px. */
  wide?: boolean;
  /** role="alertdialog" for destructive confirmations. */
  alert?: boolean;
  className?: string;
}

/**
 * Modal dialog: rendered in a portal, aria-modal, focus trapped inside while
 * open, Esc closes, focus returns to the element that opened it, page scroll
 * locked.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  initialFocusRef,
  dismissOnBackdrop = true,
  wide = false,
  alert = false,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const bodyId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || !mounted) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const target =
      initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel ?? null;
    target?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = overflow;
      const back = returnFocusRef.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [open, mounted, initialFocusRef]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={children ? bodyId : undefined}
        tabIndex={-1}
        className={cx(styles.dialog, wide && styles.wide, className)}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children ? (
          <div id={bodyId} className={styles.body}>
            {children}
          </div>
        ) : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
