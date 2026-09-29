'use client';

import { useEffect, useState } from 'react';
import styles from './SaveButton.module.css';

const KEY = 'saved-products';

function readSaved(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default function SaveButton({ productId }: { productId: string }) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSaved(readSaved().includes(productId));
    setReady(true);
  }, [productId]);

  const toggle = () => {
    const list = readSaved();
    const next = list.includes(productId)
      ? list.filter((id) => id !== productId)
      : [...list, productId];
    localStorage.setItem(KEY, JSON.stringify(next));
    setSaved(next.includes(productId));
  };

  if (!ready) return null;

  return (
    <button
      type="button"
      className={`${styles.button} ${saved ? styles.saved : ''}`}
      onClick={toggle}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save for later'}
    >
      {saved ? 'Saved ✓' : 'Save'}
    </button>
  );
}
