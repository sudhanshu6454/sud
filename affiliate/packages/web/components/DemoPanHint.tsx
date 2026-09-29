import styles from './DemoPanHint.module.css';

/** What every demo PAN line adds: no PAN or KYC check exists in this build. */
export const DEMO_PAN_DISCLAIMER = ' — demo, no PAN check was made';

/**
 * The demo PAN state, one wording on every screen (3a onboarding, 2d
 * settings): "Verified · DEMO PRIYA NAIR" in the field's accent hint, then
 * the neutral " — demo, no PAN check was made". Use inside a Field hint
 * with hintTone="accent".
 */
export function DemoPanHint({ name }: { name: string }) {
  return (
    <>
      Verified · {name}
      <span className={styles.demo}>{DEMO_PAN_DISCLAIMER}</span>
    </>
  );
}
