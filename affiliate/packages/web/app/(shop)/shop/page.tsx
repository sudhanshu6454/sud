import DemoBadge from '@/components/DemoBadge';
import LookGrid from '@/components/LookGrid';
import { listLooks } from '@/lib/catalogue';
import styles from './page.module.css';

// Rendered per request; the catalogue fetch itself is cached for 60 s
// (lib/catalogue.ts), so the grid is never a build-time snapshot.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { value: looks, demo } = await listLooks();

  return (
    <div>
      <h1 className={styles.heading}>Shop the looks</h1>
      <p className={styles.sub}>Spotted on your favourite pages — shop exact matches and similar styles.</p>
      {demo && <DemoBadge />}
      <LookGrid looks={looks} />
    </div>
  );
}
