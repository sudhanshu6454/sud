import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: 'Paparazzi Commerce',
  description:
    'Shop celebrity looks — exact matches and similar styles from trusted Indian merchants.',
  appleWebApp: {
    capable: true,
    title: 'Paparazzi',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111111',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            Paparazzi
          </Link>
          <div className={styles.headerRight}>
            {/*
              Locale toggle — STUBBED (visual only).
              Does not change language yet; EN/हिं i18n is phase-2 work.
            */}
            <div
              className={styles.localeToggle}
              role="group"
              aria-label="Language (stub)"
              title="Language switch is a stub — EN/हिं i18n not wired yet"
            >
              <button type="button" className={styles.localeActive} aria-pressed="true">
                EN
              </button>
              <button type="button" aria-pressed="false">
                हिं
              </button>
            </div>
          <nav className={styles.nav} aria-label="Sections">
            <Link href="/portal" className={styles.navLink}>
              Portal
            </Link>
            <Link href="/console" className={styles.navLink}>
              Console
            </Link>
            <Link href="/saved" className={styles.navLink}>
              Saved
            </Link>
          </nav>
          </div>
        </header>
        <main className={styles.main}>{children}</main>
        <footer className={styles.footer}>
          <p className={styles.disclosureLine}>
            Affiliate disclosure: we may earn a commission when you shop via these
            links, at no extra cost to you.
          </p>
          <p className={styles.finePrint}>© 2026 Paparazzi Commerce</p>
        </footer>
      </body>
    </html>
  );
}
