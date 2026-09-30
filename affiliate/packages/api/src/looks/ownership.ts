/**
 * The owner's statement that the organisation owns its paparazzi library (the
 * owner, 2026-09-30: "all clips are owned by us"; "all footages captured in
 * public place of any celebrity they dont own the rights we own it").
 *
 * Recorded on the server only (deploy/linode/looks.sh owned → the CLI's
 * `ownership --record`), dated, append-only (library_ownership_statements,
 * 0007 section 11): a new statement supersedes the one before, a withdrawal
 * is a row of its own. While one is in force, a library row that leaves
 * every licence column blank takes its licence from it (the library import's
 * owned default): commercial reuse yes, worldwide, no end, the copyright
 * owner the statement names, the acquisition it records, and the statement
 * itself as the assignment reference. That chain of title is the owner's
 * word, recorded as such (assets.licence_via = 'statement'); it is not a
 * finding by counsel. A row that fills any licence column carries its own
 * licence instead (the per-row override).
 *
 * Withdrawing the statement narrows at once, in the same transaction, every
 * asset whose licence came from a statement (commercial_reuse 'unknown': no
 * image is shown), and clears the look caches after the commit.
 *
 * What it does not answer: a celebrity's personality rights and whether a
 * look is editorial or commercial use. Those stay with each celebrity's
 * rights review (celebrities.rights_status, looks.sh review); nothing about
 * a celebrity is published without one.
 */
import { getPool } from '../db.js';
import { audit, scoped, toIso, type Scoped } from './sql.js';
import { invalidateAfterCommit, lookTags } from './invalidate.js';

export type OwnershipAcquisition = 'staff' | 'other';

export interface OwnershipStatement {
  id: string;
  seq: number;
  copyright_owner: string;
  acquisition: OwnershipAcquisition;
  statement: string;
  recorded_by: string;
  /** ISO time. */
  recorded_at: string;
}

/** The licence a library row takes from the statement (the owned default). */
export interface OwnedLicence {
  license: string;
  commercial_reuse: 'yes';
  territory: 'WW';
  expires_at: null;
  copyright_owner: string;
  acquisition: OwnershipAcquisition;
  assignment_ref: string;
}

/** The statement's words, as the owner confirms them at the prompt and as they are stored. */
export function ownershipStatementText(copyrightOwner: string, acquisition: OwnershipAcquisition): string {
  const who =
    acquisition === 'staff'
      ? `were shot by ${copyrightOwner}'s own employees`
      : `were shot by ${copyrightOwner}'s own employees or by freelancers and agencies working for it`;
  return (
    `All clips and stills in the paparazzi library ${who}, in public places, and ${copyrightOwner} owns the copyright in them. ` +
    `Recorded by the owner as the basis for the library's licence; it does not cover the rights of the people filmed.`
  );
}

export function ownershipProblems(copyrightOwner: string, acquisition: string): string[] {
  const out: string[] = [];
  const name = copyrightOwner.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 200) out.push('the copyright owner is 2-200 characters (the legal name of the company or person that owns the footage)');
  if (!/\p{L}/u.test(name)) out.push('the copyright owner has letters');
  if (acquisition !== 'staff' && acquisition !== 'other') out.push("the acquisition is 'staff' (own employees only) or 'other' (employees, freelancers and agencies)");
  return out;
}

/** The licence facts of the owned default, from the statement in force. */
export function ownedLicence(s: OwnershipStatement): OwnedLicence {
  const day = s.recorded_at.slice(0, 10);
  return {
    license: `Owned by ${s.copyright_owner} (the owner's statement of ${day})`.slice(0, 200),
    commercial_reuse: 'yes',
    territory: 'WW',
    expires_at: null,
    copyright_owner: s.copyright_owner,
    acquisition: s.acquisition,
    assignment_ref: `owner-statement:${s.id} ${day}`,
  };
}

interface StatementRow {
  id: string;
  seq: number;
  kind: string;
  copyright_owner: string | null;
  acquisition: string | null;
  statement: string;
  recorded_by: string;
  recorded_at: string | Date;
}

const COLS = 'id, seq, kind, copyright_owner, acquisition, statement, recorded_by, recorded_at';

function toStatement(r: StatementRow): OwnershipStatement {
  return {
    id: r.id,
    seq: Number(r.seq),
    copyright_owner: r.copyright_owner as string,
    acquisition: r.acquisition as OwnershipAcquisition,
    statement: r.statement,
    recorded_by: r.recorded_by,
    recorded_at: toIso(r.recorded_at) as string,
  };
}

async function latestRow(q: Scoped): Promise<StatementRow | undefined> {
  return (await q<StatementRow>(`select ${COLS} from library_ownership_statements where org_id = $1 order by seq desc limit 1`)).rows[0];
}

/** The statement in force for the organisation, or null (none recorded, or the latest withdrawn). */
export async function currentOwnershipStatement(q: Scoped): Promise<OwnershipStatement | null> {
  const r = await latestRow(q);
  return r && r.kind === 'owned' ? toStatement(r) : null;
}

export async function ownershipStatementFor(orgId: string): Promise<OwnershipStatement | null> {
  const client = await getPool().connect();
  try {
    return await currentOwnershipStatement(scoped(client, orgId));
  } finally {
    client.release();
  }
}

export class OwnershipRefusal extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('; '));
    this.name = 'OwnershipRefusal';
    this.problems = problems;
  }
}

/** The library import's per-organisation advisory lock; recording or withdrawing a statement takes it too. */
export const LIBRARY_LOCK_KEY = (orgId: string) => `library-import:${orgId}`;

/**
 * One transaction under the library lock, or a refusal while an import holds
 * it: an import reads the statement after taking the lock, so no import can
 * write a statement's licence after that statement was withdrawn.
 */
async function underLibraryLock<T>(orgId: string, fn: (q: Scoped) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext($1)) as locked`, [LIBRARY_LOCK_KEY(orgId)])).rows[0]?.locked === true;
    if (!locked) throw new OwnershipRefusal(['a library import is running for this organisation; try again when it finishes']);
    await client.query('BEGIN');
    const out = await fn(scoped(client, orgId));
    await client.query('COMMIT');
    return out;
  } catch (err) {
    if (locked) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the original error is what matters
      }
    }
    throw err;
  } finally {
    if (locked) {
      try {
        await client.query(`select pg_advisory_unlock(hashtext($1))`, [LIBRARY_LOCK_KEY(orgId)]);
      } catch {
        // closing the session drops the lock anyway
      }
    }
    client.release();
  }
}

/**
 * Record the owner's statement (a new row; the one before stays as history).
 * Assets already carrying a statement's licence move to the new one on the
 * next import (their licence text and reference change; the import applies
 * that because their licence came from a statement).
 */
export async function recordOwnershipStatement(
  orgId: string,
  actorId: string,
  input: { copyright_owner: string; acquisition: string },
): Promise<{ statement: OwnershipStatement; superseded: string | null }> {
  const problems = ownershipProblems(input.copyright_owner, input.acquisition);
  if (problems.length) throw new OwnershipRefusal(problems);
  const name = input.copyright_owner.replace(/\s+/g, ' ').trim();
  const acquisition = input.acquisition as OwnershipAcquisition;
  return underLibraryLock(orgId, async (q) => {
    const prev = await latestRow(q);
    const seq = (prev ? Number(prev.seq) : 0) + 1;
    const row = (
      await q<StatementRow>(
        `insert into library_ownership_statements (org_id, seq, kind, copyright_owner, acquisition, statement, recorded_by)
         values ($1, $2, 'owned', $3, $4, $5, $6) returning ${COLS}`,
        [seq, name, acquisition, ownershipStatementText(name, acquisition), actorId],
      )
    ).rows[0] as StatementRow;
    await audit(q, actorId, 'library.ownership_statement', 'library_ownership_statement', row.id);
    return { statement: toStatement(row), superseded: prev && prev.kind === 'owned' ? prev.id : null };
  });
}

/**
 * Withdraw the statement in force: a 'withdrawn' row, and every asset whose
 * licence came from a statement narrowed to commercial_reuse 'unknown' in
 * the same transaction (no image is shown; a later import with a statement
 * in force, or a rights reviewer's edit, records a licence again).
 */
export async function withdrawOwnershipStatement(orgId: string, actorId: string, reason: string): Promise<{ withdrawn: string; assets_narrowed: number }> {
  const why = reason.replace(/\s+/g, ' ').trim();
  if (why.length < 10 || why.length > 500) throw new OwnershipRefusal(['the reason is 10-500 characters']);
  const out = await underLibraryLock(orgId, async (q) => {
    const prev = await latestRow(q);
    if (!prev || prev.kind !== 'owned') throw new OwnershipRefusal(['no ownership statement is in force; nothing changed']);
    const row = (
      await q<{ id: string }>(
        `insert into library_ownership_statements (org_id, seq, kind, statement, recorded_by)
         values ($1, $2, 'withdrawn', $3, $4) returning id`,
        [Number(prev.seq) + 1, `Withdrawn: ${why}`.slice(0, 2000), actorId],
      )
    ).rows[0] as { id: string };
    const narrowed = (
      await q<{ id: string }>(
        `update assets set commercial_reuse = 'unknown', updated_at = now()
          where org_id = $1 and licence_via = 'statement' and commercial_reuse <> 'unknown'
          returning id`,
      )
    ).rows;
    await audit(q, actorId, 'library.ownership_withdrawn', 'library_ownership_statement', row.id);
    // Every page that can show one of those stills: the look, its celebrity's hub, its page's storefront.
    const looks = (
      await q<{ id: string; celebrity_slug: string | null; storefront_slug: string | null }>(
        `select l.id, c.slug as celebrity_slug, s.slug as storefront_slug
           from looks l
           join assets a on a.org_id = l.org_id and a.id = l.still_asset_id
           left join celebrities c on c.org_id = l.org_id and c.id = l.celebrity_id
           left join storefronts s on s.org_id = l.org_id and s.property_id = l.property_id
          where l.org_id = $1 and a.licence_via = 'statement'`,
      )
    ).rows;
    return { withdrawn: row.id, assets_narrowed: narrowed.length, tags: [...new Set(['spotted', 'sitemap', ...looks.flatMap((l) => lookTags(l))])] };
  });
  await invalidateAfterCommit({ tokens: [], tags: out.tags });
  return { withdrawn: out.withdrawn, assets_narrowed: out.assets_narrowed };
}
