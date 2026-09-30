import Link from 'next/link';
import { cx } from '../ui/cx';
import styles from './CelebrityCredit.module.css';

export interface CelebrityCreditProps {
  celebrity: { name: string; slug: string };
  /** The API's non-endorsement line (a draft pending counsel); it starts with the name. */
  nonEndorsement: string;
  /** Link the name to the celebrity's hub (/c/<slug>). */
  link?: boolean;
  /** 'page' (15px, the look and hub pages) or 'card' (14px): the line is always the size of the text beside it. */
  size?: 'page' | 'card';
  /** 'span' inside another paragraph (a PageHeader's description is a <p>). */
  as?: 'p' | 'span';
  className?: string;
}

/**
 * Wherever a celebrity is named: the non-endorsement line in the same
 * language and the same type size as the text it sits in (the brief's B3;
 * CCPA 2022 cl.11: "the font used in a disclaimer shall be the same"), with
 * the name in it linked to the hub. One paragraph, so the two never
 * separate.
 */
export function CelebrityCredit({ celebrity, nonEndorsement, link = true, size = 'page', as: Tag = 'p', className }: CelebrityCreditProps) {
  const startsWithName = nonEndorsement.startsWith(celebrity.name);
  const rest = startsWithName ? nonEndorsement.slice(celebrity.name.length) : null;
  return (
    <Tag className={cx(styles.credit, size === 'card' ? styles.card : styles.page, className)} data-non-endorsement="">
      {rest !== null && link ? (
        <>
          <Link href={`/c/${celebrity.slug}`} className={styles.name}>
            {celebrity.name}
          </Link>
          {rest}
        </>
      ) : (
        nonEndorsement
      )}
    </Tag>
  );
}
