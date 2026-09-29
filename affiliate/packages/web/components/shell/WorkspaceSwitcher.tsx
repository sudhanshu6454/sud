import Link from 'next/link';
import styles from './WorkspaceSwitcher.module.css';

export interface WorkspaceOption {
  label: string;
  meta?: string;
  href: string;
}

export interface WorkspaceSwitcherProps {
  /** The workspace you are in, e.g. "Demo Loop Talent". */
  current: string;
  options: ReadonlyArray<WorkspaceOption>;
}

/** Sidebar slot: shows the current workspace and links into the others. */
export function WorkspaceSwitcher({ current, options }: WorkspaceSwitcherProps) {
  return (
    <details className={styles.switcher}>
      <summary className={styles.summary}>
        <span className={styles.label}>Workspace</span>
        <span className={styles.current}>{current}</span>
        <span className={styles.toggle}>Switch</span>
      </summary>
      <ul className={styles.list}>
        {options.map((o) => (
          <li key={o.href + o.label}>
            <Link href={o.href} className={styles.option}>
              {o.label}
              {o.meta ? <span className={styles.optionMeta}>{o.meta}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
