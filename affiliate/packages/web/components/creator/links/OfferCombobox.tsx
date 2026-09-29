'use client';

/*
 * Searchable offer select (3c "Offer"): an ARIA 1.2 combobox — a text input
 * with a listbox popup. Shows the chosen offer as "Demo Style Festive ·
 * 12% / sale" (as drawn); typing filters by brand, category and model;
 * ↓/↑ move, Enter picks, Esc closes and restores the choice. Sits inside a
 * <Field> (the label's htmlFor points at the input).
 *
 * Candidate for promotion to components/ui (a generic Combobox).
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './OfferCombobox.module.css';

export interface ComboOption {
  id: string;
  /** What the input shows once chosen. */
  label: string;
  /** Second line in the list ("D2C fashion · CPS"). */
  meta?: string;
  /** Text the filter searches (defaults to label + meta). */
  search?: string;
}

export interface OfferComboboxProps {
  options: ReadonlyArray<ComboOption>;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}

export function OfferCombobox({ options, value, onChange, placeholder = 'Search offers', className }: OfferComboboxProps) {
  const listId = `cb${useId().replace(/:/g, '')}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.id === value);
  const text = query ?? selected?.label ?? '';

  const filtered = useMemo(() => {
    const words = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter((o) => {
      const haystack = (o.search ?? `${o.label} ${o.meta ?? ''}`).toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [options, query]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function openList() {
    const at = Math.max(0, filtered.findIndex((o) => o.id === value));
    setActive(query === null ? Math.max(0, options.findIndex((o) => o.id === value)) : at);
    setOpen(true);
  }

  function close(restore = true) {
    setOpen(false);
    if (restore) setQuery(null);
  }

  function pick(option: ComboOption) {
    onChange(option.id);
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActive((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(Math.max(0, filtered.length - 1));
        }
        break;
      case 'Enter': {
        if (!open) return;
        event.preventDefault();
        const option = filtered[active];
        if (option) pick(option);
        break;
      }
      case 'Escape':
        if (open || query !== null) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  }

  const activeOption = open ? filtered[active] : undefined;

  return (
    <div className={cx(styles.wrap, className)}>
      <Input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${activeOption.id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={text}
        placeholder={placeholder}
        className={styles.input}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => close()}
      />
      <span className={styles.chevron} aria-hidden="true" />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Offers"
        className={styles.list}
        hidden={!open}
      >
        {filtered.length === 0 ? (
          <li role="option" aria-selected={false} aria-disabled="true" className={styles.none}>
            No offers match “{(query ?? '').trim()}”.
          </li>
        ) : (
          filtered.map((option, i) => (
            <li
              key={option.id}
              id={`${listId}-${option.id}`}
              role="option"
              aria-selected={option.id === value}
              data-index={i}
              className={cx(styles.option, i === active && styles.active, option.id === value && styles.selected)}
              // mousedown, not click: keeps focus in the input so onBlur does not close first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.optionLabel}>{option.label}</span>
              {option.meta ? <span className={styles.optionMeta}>{option.meta}</span> : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
