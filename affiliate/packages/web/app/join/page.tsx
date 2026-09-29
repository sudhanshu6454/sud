import type { Metadata } from 'next';
import Link from 'next/link';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';
import { Lockup } from '@/components/ui/Logo';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Join' };

/** Placeholder — the 3-step sign-up & onboarding (2a, 3a) replaces this page (it has no marketing chrome). */
export default function JoinPage() {
  return (
    <main id="main">
      <div className={styles.top}>
        <Link href="/" className={styles.home} aria-label="afflino — home">
          <Lockup markSize={28} />
        </Link>
      </div>
      <ScreenPlaceholder eyebrow="Step 1 of 3" title="How will you use Afflino?" artboard="2a, 3a" />
    </main>
  );
}
