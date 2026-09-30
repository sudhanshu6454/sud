/**
 * Small helpers for the celebrity-looks modules: tenant-scoped queries through
 * a transaction's client, the transaction wrapper, audit and outbox rows, and
 * date / timestamp normalisation (pg returns timestamptz as Date or string,
 * pg-mem as Date; a `date` column comes back as a Date at local midnight from
 * pg and at UTC midnight from pg-mem).
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { buildEnvelope } from '@paparazzi/shared';
import { getPool } from '../db.js';
import type { Queryable } from '../links/mint.js';

/** `$1` is the org_id and the text must name org_id (the tenantQuery rule, for any Queryable). */
export function scoped(db: Queryable, orgId: string) {
  return async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (!/\borg_id\b/.test(text)) throw new Error('tenant query invariant violated: query text must reference org_id');
    return db.query<T>(text, [orgId, ...params]);
  };
}

export type Scoped = ReturnType<typeof scoped>;

/** BEGIN … COMMIT on one pooled client; ROLLBACK (best-effort) and rethrow on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(q: Scoped, actorId: string | null, action: string, entity: string, entityId: string): Promise<void> {
  await q(`insert into audit_log (org_id, actor_id, action, entity, entity_id) values ($1, $2, $3, $4, $5)`, [actorId, action, entity, entityId]);
}

export async function outbox(q: Scoped, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const envelope = buildEnvelope({ source: 'api', event_type: eventType, payload });
  await q(
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

export function toIso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A `date` column as YYYY-MM-DD, whichever driver returned it. */
export function isoDate(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  if (Number.isNaN(value.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  // pg: local midnight; pg-mem: UTC midnight.
  if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** Today's date in India (IST, UTC+05:30, no daylight saving) as YYYY-MM-DD. */
export function istToday(now: number = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/** The UTC instants bounding an IST calendar day: [start, end). */
export function istDayBounds(day: string): { start: string; end: string } {
  const start = new Date(`${day}T00:00:00+05:30`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
