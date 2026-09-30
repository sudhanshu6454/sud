import { Tag } from '../ui/Tag';
import { cx } from '../ui/cx';
import styles from './CommercialLabel.module.css';

/**
 * The commercial label at the very top of every page about a celebrity (a
 * look, a hub, a storefront, the Spotted feed): upfront, never buried (ASCI;
 * the brief's B5). The text is the API's (`commercial_label`, "Ad · This page
 * has affiliate links", a draft pending counsel); its first part is set as a
 * tag, the rest beside it in the same line.
 */
export function CommercialLabel({ text, className }: { text: string; className?: string }) {
  const at = text.indexOf(' · ');
  const head = at > 0 ? text.slice(0, at) : text;
  const rest = at > 0 ? text.slice(at + 3) : '';
  return (
    <p className={cx(styles.label, className)} data-commercial-label="">
      <Tag variant="accent">{head}</Tag>
      {rest ? <span className={styles.text}>{rest}</span> : null}
    </p>
  );
}
