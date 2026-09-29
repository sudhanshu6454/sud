'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { Button } from '../ui/Button';
import { Lockup } from '../ui/Logo';
import { cx } from '../ui/cx';
import styles from './MarketingNav.module.css';

export const MARKETING_LINKS = [
  { label: 'For brands', href: '/#brands' },
  { label: 'For creators', href: '/#creators' },
  { label: 'Offers', href: '/app/offers' },
  { label: 'Pricing', href: '/#pricing' },
] as const;

/** The public site's top bar (1b). */
export function MarketingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => setOpen(false), [pathname]);
  const loginCurrent = pathname === '/login' ? ('page' as const) : undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={styles.bar}>
      <div className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="afflino — home">
          <Lockup markSize={28} />
        </Link>
        <nav className={styles.links} aria-label="Main">
          {MARKETING_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={styles.link}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          <Button variant="ghost" href="/login" className={styles.login} aria-current={loginCurrent}>
            Log in
          </Button>
          <Button variant="primary" href="/join" className={styles.join}>
            Join the network
          </Button>
          <Button
            variant="secondary"
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Menu'}
          </Button>
        </div>
      </div>
      <div id={menuId} className={cx(styles.menu)} hidden={!open}>
        <nav className={styles.menuLinks} aria-label="Main (menu)">
          {MARKETING_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={styles.menuLink} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.menuActions}>
          <Button variant="secondary" href="/login" block flush touch aria-current={loginCurrent}>
            Log in
          </Button>
          <Button variant="primary" href="/join" block flush touch arrow>
            Join the network
          </Button>
        </div>
      </div>
    </header>
  );
}
