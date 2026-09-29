/**
 * Retention window configuration.
 *
 * Windows are ENVIRONMENT, not code: counsel owns the numbers
 * (see docs/counsel-briefing.md §1 — the 90-day raw click-metadata figure in
 * the brief is a planning assumption awaiting counsel's decision). The purge
 * mechanism itself is window-agnostic; only these defaults live here.
 *
 * Conservative sandbox defaults: 365 days per class. Rationale: the sandbox
 * has no counsel decision yet, and the pilot needs long-lived data for
 * reconciliation/dispute windows; counsel is expected to SHORTEN these, never
 * to lengthen them silently. Any change is a one-line env edit, no deploy of
 * new logic.
 */

import { createLogger } from '../logging';

const log = createLogger('retention:config');

/** Sandbox default: raw click context payloads (clicks.context). */
export const DEFAULT_CLICK_CONTEXT_DAYS = 365;
/** Sandbox default: raw provider event payloads (conversions.raw). */
export const DEFAULT_CONVERSION_RAW_DAYS = 365;
/** Sandbox default: published outbox rows (relay completed). */
export const DEFAULT_OUTBOX_DAYS = 365;
/** Sandbox default: daily at 03:00 server time (BullMQ cron pattern). */
export const DEFAULT_RETENTION_CRON = '0 3 * * *';

export interface RetentionConfig {
  /** Days after clicks.occurred_at before clicks.context is nulled. */
  clickContextDays: number;
  /** Days after conversions.received_at before conversions.raw is nulled. */
  conversionRawDays: number;
  /** Days after outbox.published_at before published outbox rows are deleted. */
  outboxDays: number;
  /** BullMQ repeat pattern for the scheduled purge. */
  cron: string;
}

function parseWindowDays(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    // A misconfigured window must never widen retention silently: fall back
    // to the conservative default and say so loudly.
    log('warn', `invalid ${name}="${raw}"; falling back to default`, {
      fallback_days: fallback,
    });
    return fallback;
  }
  return n;
}

/** Load retention windows from the environment. Never throws. */
export function loadRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  return {
    clickContextDays: parseWindowDays(
      env.RETENTION_CLICK_CONTEXT_DAYS,
      'RETENTION_CLICK_CONTEXT_DAYS',
      DEFAULT_CLICK_CONTEXT_DAYS,
    ),
    conversionRawDays: parseWindowDays(
      env.RETENTION_CONVERSION_RAW_DAYS,
      'RETENTION_CONVERSION_RAW_DAYS',
      DEFAULT_CONVERSION_RAW_DAYS,
    ),
    outboxDays: parseWindowDays(
      env.RETENTION_OUTBOX_DAYS,
      'RETENTION_OUTBOX_DAYS',
      DEFAULT_OUTBOX_DAYS,
    ),
    cron: env.RETENTION_CRON?.trim() || DEFAULT_RETENTION_CRON,
  };
}
