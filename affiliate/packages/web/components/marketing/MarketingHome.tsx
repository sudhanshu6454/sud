import { Button } from '../ui/Button';
import { Eyebrow } from '../ui/Eyebrow';
import { cx } from '../ui/cx';
import { HERO, HERO_STATS, PLANS, POSTER, STEPS, CTA } from './copy';
import styles from './MarketingHome.module.css';

/**
 * The marketing site (design 1b): hero with the three stat rows, How it works
 * (#brands), Pricing (#pricing) and the red poster close (#creators). The nav
 * and footer come from the (marketing) layout. Every figure is read from
 * lib/site-copy.ts through ./copy.
 */
export function MarketingHome() {
  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroMain}>
          <Eyebrow tone="accent" tracking="wide">
            {HERO.eyebrow}
          </Eyebrow>
          <h1 id="hero-title" className={styles.display}>
            {HERO.title}
          </h1>
          <p className={styles.lead}>{HERO.body}</p>
          <div className={styles.ctas}>
            <Button variant="primary" href={CTA.listOffer.href} arrow className={styles.cta}>
              {CTA.listOffer.label}
            </Button>
            <Button variant="secondary" href={CTA.becomeCreator.href} arrow className={styles.cta}>
              {CTA.becomeCreator.label}
            </Button>
          </div>
        </div>
        <ul className={styles.stats} aria-label="Afflino in numbers">
          {HERO_STATS.map((stat) => (
            <li key={stat.label} className={styles.stat}>
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="brands" className={styles.steps} aria-labelledby="how-title">
        <h2 id="how-title" className="sr-only">
          How it works
        </h2>
        {STEPS.map((step) => (
          <div key={step.eyebrow} className={styles.step}>
            <Eyebrow tracking="wide">{step.eyebrow}</Eyebrow>
            <h3 className={styles.stepTitle}>{step.title}</h3>
            <p className={styles.stepBody}>{step.body}</p>
          </div>
        ))}
      </section>

      <section id="pricing" className={styles.pricing} aria-labelledby="pricing-title">
        <h2 id="pricing-title" className="sr-only">
          Pricing for brands
        </h2>
        {PLANS.map((plan) => (
          <article key={plan.key} className={styles.plan} aria-labelledby={`plan-${plan.key}`}>
            <Eyebrow tracking="wide" tone={plan.featured ? 'accent' : 'muted'}>
              {plan.eyebrow}
            </Eyebrow>
            <h3 id={`plan-${plan.key}`} className={styles.planName}>
              {plan.name}
            </h3>
            <p className={styles.planPrice}>{plan.priceLine}</p>
            <ul className={styles.planFeatures}>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Button
              variant={plan.featured ? 'primary' : 'secondary'}
              href={plan.cta.href}
              arrow
              className={cx(styles.cta, styles.planCta)}
            >
              {plan.cta.label}
            </Button>
          </article>
        ))}
      </section>

      {POSTER ? (
        <section id="creators" className={styles.poster} aria-labelledby="creators-title">
          <h2 id="creators-title" className={styles.posterTitle}>
            {POSTER.title}
          </h2>
          <div className={styles.posterAside}>
            <p className={styles.posterBody}>{POSTER.body}</p>
            <Button variant="inverse" href={POSTER.cta.href} arrow className={styles.cta}>
              {POSTER.cta.label}
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
