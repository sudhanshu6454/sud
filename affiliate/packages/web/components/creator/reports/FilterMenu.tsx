'use client';

/*
 * A filter tag that opens a small menu (3d filter bar). Looks exactly like
 * the outline tag the artboard draws; behaves as an ARIA menu button with
 * radio items: Enter / Space / ArrowDown open it on the current choice,
 * ArrowUp on the last; inside, the arrow keys, Home and End move, Enter or
 * Space picks, Escape closes and returns focus, Tab and a click outside
 * close it. Candidate for promotion to components/ui.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/components/ui';
import styles from './FilterMenu.module.css';

export interface FilterMenuOption<T extends string = string> {
  value: T;
  label: string;
}

export interface FilterMenuProps<T extends string = string> {
  /** What the menu filters ("Date range"); names the menu and prefixes the trigger's accessible name. */
  label: string;
  value: T;
  options: ReadonlyArray<FilterMenuOption<T>>;
  onChange: (value: T) => void;
  /** Trigger text for the current option (default: its label), e.g. "Group by: day". */
  triggerText?: (option: FilterMenuOption<T>) => string;
  className?: string;
}

export function FilterMenu<T extends string = string>({
  label,
  value,
  options,
  onChange,
  triggerText,
  className,
}: FilterMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [alignStart, setAlignStart] = useState(false);
  const menuRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const current = options[selectedIndex] ?? options[0]!;
  const text = triggerText ? triggerText(current) : current.label;
  const accessibleName = text.toLowerCase().startsWith(label.toLowerCase()) ? undefined : `${label}: ${text}`;

  const openAt = useCallback((index: number) => {
    setActive(index);
    setOpen(true);
  }, []);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // The menu hangs from the trigger's right edge (the filter bar sits on the
  // right); if that would push it off the left of the screen (phones), it
  // hangs from the left edge instead.
  useLayoutEffect(() => {
    if (!open) {
      setAlignStart(false);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect && rect.left < 8) setAlignStart(true);
  }, [open]);

  // Move focus to the active item while the menu is open.
  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  // A pointer press outside closes the menu (focus stays where it lands).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const pick = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt(selectedIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(options.length - 1);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(last);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={wrapRef} className={cx(styles.wrap, className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(styles.trigger, open && styles.open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={accessibleName}
        onClick={() => (open ? close(false) : openAt(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
      >
        {text}
      </button>
      {open ? (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx(styles.menu, alignStart && styles.alignStart)}
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option, i) => {
            const checked = option.value === value;
            return (
              <li key={option.value} role="none">
                <button
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={i === active ? 0 : -1}
                  className={cx(styles.item, checked && styles.checked)}
                  onClick={() => pick(i)}
                  onMouseEnter={() => setActive(i)}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
