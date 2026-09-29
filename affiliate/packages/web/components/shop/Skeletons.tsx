import cardStyles from '../LookCard.module.css';
import gridStyles from '../LookGrid.module.css';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
import styles from './Skeletons.module.css';

/*
 * The grid's route-level loading state (app/(shop)/shop/loading.tsx): neutral-200 blocks
 * at the size of what they stand in for, in the real layout classes, so the
 * page does not jump when the catalogue answers. No spinners. The look and
 * item routes have none on purpose: a Suspense boundary starts the stream
 * before notFound() can set the 404 status.
 */

function Loading({ label }: { label: string }) {
  return (
    <span className="sr-only" role="status">
      {label}
    </span>
  );
}

export function ShopGridSkeleton() {
  return (
    <>
      <PageHeader
        className={gridStyles.header}
        eyebrow="Shop the looks"
        title={
          <>
            <Skeleton inline width={220} height={28} />
            <Loading label="Loading looks" />
          </>
        }
        description={<Skeleton inline width={420} height={14} className={styles.shrink} />}
        actions={<Skeleton width={320} height={43} className={styles.search} />}
      />
      <div className={gridStyles.filters} aria-hidden="true">
        <div className={gridStyles.tags}>
          {[34, 84, 62, 68].map((w) => (
            <Skeleton key={w} inline width={w} height={23} />
          ))}
        </div>
      </div>
      <div className={gridStyles.gridWrap} aria-hidden="true">
        <ul className={gridStyles.grid}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={cardStyles.cell}>
              <div className={cardStyles.head}>
                <Skeleton width={90} height={12} />
              </div>
              <div className={cardStyles.cover}>
                <Skeleton height="auto" className={styles.frame} />
              </div>
              <Skeleton width="80%" height={26} />
              <Skeleton width="55%" height={14} />
              <div className={cardStyles.countRow}>
                <Skeleton width={120} height={30} />
              </div>
              <Skeleton height={35} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
