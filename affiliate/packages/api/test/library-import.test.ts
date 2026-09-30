// The paparazzi library import (src/looks/library-import.ts) on pg-mem:
// assets with their licence metadata, celebrities created unreviewed, DRAFT
// looks with their pieces; idempotent on the video ref; refused as a whole
// (nothing written) on a missing licence field, an unknown page, a sensitive
// place, endorsement wording, disagreeing rows; TEST rows refused under
// NODE_ENV=production. The owned default (src/looks/ownership.ts): rows
// without licence columns take the owner's recorded ownership statement,
// a row with them its own; a person's licence edit is never widened by a
// file; withdrawing the statement narrows what it licensed. TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_library_import';
process.env.JWT_SECRET ??= 'library-import-test-secret';
process.env.API_PORT ??= '0';

import { beforeAll, describe, expect, it } from 'vitest';
import { libraryFixture, setupCelebrityWorld, type CelebCtx } from './celebrity-fixtures.js';
import type * as Import from '../src/looks/library-import.js';

const ORG = 'cccc3333-cccc-3333-cccc-333333333333';
let ctx: CelebCtx;
let lib: typeof Import;

async function counts() {
  const q = async (t: string) => Number((await ctx.pool.query(`select count(*)::int as n from ${t} where org_id = $1`, [ORG])).rows[0]!.n);
  return { assets: await q('assets'), looks: await q('looks'), celebrities: await q('celebrities'), pieces: await q('look_pieces') };
}

const HEADER = libraryFixture().split('\n')[0] as string;
const ROW = libraryFixture().split('\n')[1] as string;
function withCell(row: string, col: string, value: string): string {
  const cols = HEADER.split(',');
  const cells = row.split(',');
  cells[cols.indexOf(col)] = value;
  return cells.join(',');
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG });
  lib = await import('../src/looks/library-import.js');
}, 60000);

describe('library import', () => {
  it('imports the TEST fixture: 2 draft looks, 2 unreviewed celebrities, video + still assets with licences, 4 pieces', async () => {
    const s = await lib.importLibrary({ orgSlug: 'afflino', text: libraryFixture() });
    expect(s).toMatchObject({ rows: 4, looks: 2, looks_created: 2, celebrities_created: 2, assets_created: 4, pieces_created: 4 });
    expect(s.created_looks.every((l) => l.celebrity_status === 'unreviewed')).toBe(true);
    const looks = await ctx.pool.query(`select library_ref, status from looks where org_id = $1 order by library_ref`, [ORG]);
    expect(looks.rows).toEqual([
      { library_ref: 'demo-vid-0001', status: 'draft' },
      { library_ref: 'demo-vid-0002', status: 'draft' },
    ]);
    const video = await ctx.pool.query(`select kind, license, commercial_reuse, territory, expires_at, source_ref, acquisition, assignment_ref from assets where storage_key = 'demo-vid-0002'`);
    expect(video.rows[0]).toMatchObject({ kind: 'video', commercial_reuse: 'unknown', territory: 'IN', expires_at: null, acquisition: 'staff', assignment_ref: 'TEST-ASSIGN-001' });
  });

  it('a second run of the same file changes nothing', async () => {
    const before = await counts();
    const s = await lib.importLibrary({ orgSlug: 'afflino', text: libraryFixture() });
    expect(s).toMatchObject({ looks_created: 0, looks_updated: 0, looks_unchanged: 2, celebrities_created: 0, celebrities_matched: 2, assets_created: 0, assets_updated: 0, pieces_created: 0, pieces_updated: 0 });
    expect(await counts()).toEqual(before);
  });

  it('updates a draft (a renewed licence, a moved hotspot); keeps a look that is no longer a draft', async () => {
    const text = libraryFixture().replaceAll('2027-12-31', '2028-06-30').replace('The shirt,shirt,0,0.42,0.35', 'The shirt,shirt,0,0.40,0.35');
    const s = await lib.importLibrary({ orgSlug: 'afflino', text });
    expect(s).toMatchObject({ assets_updated: 2, pieces_updated: 1 });
    await ctx.pool.query(`update looks set status = 'in_review' where library_ref = 'demo-vid-0002' and org_id = $1`, [ORG]);
    const moved = await lib.importLibrary({ orgSlug: 'afflino', text: text.replace('Demo Airport Arrival', 'Demo Airport Departure') });
    expect(moved.looks_not_draft_kept).toBe(1);
    const two = await ctx.pool.query(`select event_name from looks where library_ref = 'demo-vid-0002'`);
    expect(two.rows[0]!.event_name).toBe('Demo Airport Arrival');
  });

  it('matches a celebrity by alias; an alias shared by two celebrities is refused', async () => {
    const aliasRow = (video: string) =>
      withCell(withCell(withCell(withCell(withCell(withCell(ROW, 'video_ref', video), 'celebrity', 'D. Star One'), 'aliases', ''), 'piece_label', 'The belt'), 'piece_category', 'belt'), 'still_ref', `demo-stills/${video}.jpg`);
    const byAlias = `${HEADER}\n${aliasRow('demo-vid-0101')}\n`;
    const s = await lib.importLibrary({ orgSlug: 'afflino', text: byAlias });
    expect(s).toMatchObject({ looks_created: 1, celebrities_created: 0, celebrities_matched: 1 });
    await ctx.pool.query(`update celebrities set aliases = $2 where org_id = $1 and slug = 'demo-star-two'`, [ORG, ['D. Star One']]);
    const before = await counts();
    await expect(lib.importLibrary({ orgSlug: 'afflino', text: `${HEADER}\n${aliasRow('demo-vid-0102')}\n` })).rejects.toThrow(/matches the aliases of several/);
    expect(await counts()).toEqual(before);
    await ctx.pool.query(`update celebrities set aliases = '{}' where org_id = $1 and slug = 'demo-star-two'`, [ORG]);
  });

  it('refuses the whole file, writing nothing, on any problem', async () => {
    const before = await counts();
    const cases: Array<[string, RegExp]> = [
      [libraryFixture().replace(HEADER, HEADER.replace(',licence_expires', ',licence_ends')), /unknown column 'licence_ends'/],
      [libraryFixture().replace(HEADER, HEADER.replace('still_ref,', 'still_key,')), /missing column 'still_ref'/],
      [`${HEADER}\n${withCell(ROW, 'licence', '')}\n`, /licence is required/],
      [`${HEADER}\n${withCell(ROW, 'commercial_reuse', 'maybe')}\n`, /commercial_reuse is yes, no or unknown/],
      [`${HEADER}\n${withCell(ROW, 'moment_date', '2099-01-01')}\n`, /in the future/],
      [`${HEADER}\n${withCell(ROW, 'place', 'Demo City Hospital')}\n`, /sensitive place/],
      [`${HEADER}\n${withCell(ROW, 'piece_label', 'Her favourite bag')}\n`, /favourite/],
      [`${HEADER}\n${withCell(ROW, 'piece_category', 'cape')}\n`, /not in the list/],
      [`${HEADER}\n${withCell(ROW, 'account', 'demo.unknown.page')}\n`, /no instagram page 'demo.unknown.page'/],
      [`${HEADER}\n${ROW}\n${withCell(ROW, 'event', 'Demo Other Event').replace('The shirt', 'The cap').replace(',shirt,', ',headwear,')}\n`, /differ from row/],
      [`${HEADER}\n${withCell(ROW, 'piece_x', '1.5')}\n`, /0\.\.1/],
    ];
    for (const [text, re] of cases) {
      await expect(lib.importLibrary({ orgSlug: 'afflino', text })).rejects.toThrow(re);
    }
    expect(await counts()).toEqual(before);
  });

  it('under NODE_ENV=production refuses TEST rows (Demo names, example.com URLs)', () => {
    const parsed = lib.parseLibraryCsv(libraryFixture(), { NODE_ENV: 'production' });
    expect(parsed.problems.some((p) => /TEST celebrity 'Demo Star One'/.test(p))).toBe(true);
    expect(parsed.problems.some((p) => /TEST URL in still_url/.test(p))).toBe(true);
    const ok = lib.parseLibraryCsv(libraryFixture(), { NODE_ENV: 'development' });
    expect(ok.problems).toEqual([]);
  });

  it('records a minor flag and never clears one: a flagged celebrity goes back to unreviewed', async () => {
    const reviewer = (await ctx.pool.query(`select id from users where email like 'reviewer@%'`)).rows[0]!.id;
    await ctx.pool.query(
      `update celebrities set rights_status = 'cleared', max_display = 'name_only', shoppable = false, rights_evidence_ref = 'TEST', rights_reviewed_by = $2, rights_reviewed_at = now()
        where org_id = $1 and slug = 'demo-star-two'`,
      [ORG, reviewer],
    );
    const text = libraryFixture().replace(/Demo Star Two,,no,/, 'Demo Star Two,,yes,');
    const s = await lib.importLibrary({ orgSlug: 'afflino', text, actorId: String(reviewer) });
    expect(s.celebrities_flagged_minor).toBe(1);
    const c = await ctx.pool.query(`select is_minor, rights_status from celebrities where org_id = $1 and slug = 'demo-star-two'`, [ORG]);
    expect(c.rows[0]).toEqual({ is_minor: true, rights_status: 'unreviewed' });
  });
});

describe('the owned default: the owner\'s ownership statement', () => {
  const OWNED_HEADER = 'video_ref,celebrity,moment_date,event,place,place_kind,platform,account,post_permalink,still_ref,still_url,source_ref,author,piece_label,piece_category';
  const ownedRow = (n: string, piece = 'The jacket,outerwear') =>
    `demo-vid-${n},Demo Star One,2026-09-01,Demo Gala ${n},Demo City,event,instagram,demo.afflino,https://instagram.example.com/p/demo-${n},demo-stills/${n}.jpg,https://cdn.example.com/demo-stills/${n}.jpg,demo-batch-03/${n},Demo Shooter,${piece}`;
  const OWNED_FILE = `${OWNED_HEADER}\n${ownedRow('0301')}\n${ownedRow('0301', 'The shoes,footwear')}\n${ownedRow('0302')}\n`;
  let own: typeof import('../src/looks/ownership.js');
  let editorial: typeof import('../src/looks/editorial.js');
  const ADMIN = '00000000-0000-0000-0000-0000000c0001';
  const asset = async (key: string) =>
    (
      await ctx.pool.query(
        `select license, commercial_reuse, territory, expires_at, copyright_owner, acquisition, assignment_ref, licence_via, author, source_ref
           from assets where org_id = $1 and storage_key = $2`,
        [ORG, key],
      )
    ).rows[0];

  beforeAll(async () => {
    own = await import('../src/looks/ownership.js');
    editorial = await import('../src/looks/editorial.js');
  });

  it('without a statement, a row without licence columns is refused and nothing is written', async () => {
    const before = await counts();
    await expect(lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE })).rejects.toThrow(/no licence: .*looks\.sh owned/);
    expect(await counts()).toEqual(before);
    const check = await lib.checkLibrary({ orgId: ORG, text: OWNED_FILE });
    expect(check).toMatchObject({ ok: false, licence_from_statement: 0, ownership_statement: null });
  });

  it('records the statement: dated, audited, its words naming the owner; bad input refused', async () => {
    await expect(own.recordOwnershipStatement(ORG, ADMIN, { copyright_owner: 'X', acquisition: 'staff' })).rejects.toThrow(/2-200 characters/);
    await expect(own.recordOwnershipStatement(ORG, ADMIN, { copyright_owner: 'Demo Media (TEST)', acquisition: 'bought' })).rejects.toThrow(/'staff'.*'other'/);
    const { statement, superseded } = await own.recordOwnershipStatement(ORG, ADMIN, { copyright_owner: '  Demo  Media (TEST) ', acquisition: 'staff' });
    expect(superseded).toBeNull();
    expect(statement).toMatchObject({ seq: 1, copyright_owner: 'Demo Media (TEST)', acquisition: 'staff', recorded_by: ADMIN });
    expect(statement.statement).toMatch(/^All clips and stills in the paparazzi library were shot by Demo Media \(TEST\)'s own employees, in public places, and Demo Media \(TEST\) owns the copyright/);
    expect(statement.statement).toMatch(/does not cover the rights of the people filmed/);
    const auditRow = await ctx.pool.query(`select action, actor_id from audit_log where org_id = $1 and entity_id = $2`, [ORG, statement.id]);
    expect(auditRow.rows).toEqual([{ action: 'library.ownership_statement', actor_id: ADMIN }]);
    expect((await own.ownershipStatementFor(ORG))?.id).toBe(statement.id);
  });

  it('a row without licence columns takes the statement: commercial reuse, worldwide, no end, its owner, the statement as the reference', async () => {
    const statement = (await own.ownershipStatementFor(ORG))!;
    const check = await lib.checkLibrary({ orgId: ORG, text: OWNED_FILE });
    expect(check).toMatchObject({ ok: true, looks_new: 2, licence_from_statement: 2, ownership_statement: { id: statement.id, copyright_owner: 'Demo Media (TEST)' } });
    const s = await lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE });
    expect(s).toMatchObject({ looks_created: 2, pieces_created: 3, assets_created: 4, licence_from_statement: 2, licence_kept: [] });
    expect(s.ownership_statement).toMatchObject({ id: statement.id, copyright_owner: 'Demo Media (TEST)', acquisition: 'staff' });
    const day = statement.recorded_at.slice(0, 10);
    for (const key of ['demo-vid-0301', 'demo-stills/0301.jpg']) {
      expect(await asset(key)).toMatchObject({
        license: `Owned by Demo Media (TEST) (the owner's statement of ${day})`,
        commercial_reuse: 'yes',
        territory: 'WW',
        expires_at: null,
        copyright_owner: 'Demo Media (TEST)',
        acquisition: 'staff',
        assignment_ref: `owner-statement:${statement.id} ${day}`,
        licence_via: 'statement',
        author: 'Demo Shooter',
        source_ref: 'demo-batch-03/0301',
      });
    }
    // The chain of title is complete, so only the frame screen (and the celebrity's review) stand between it and the page.
    const { assetImageRefusals } = await import('@paparazzi/shared');
    const still = (await ctx.pool.query(`select * from assets where org_id = $1 and storage_key = 'demo-stills/0301.jpg'`, [ORG])).rows[0];
    expect(assetImageRefusals(still)).toEqual(['frame_not_screened']);
    // Nothing about the celebrity changes: the look is a draft, the rights review still decides.
    const look = await ctx.pool.query(`select status from looks where org_id = $1 and library_ref = 'demo-vid-0301'`, [ORG]);
    expect(look.rows[0]!.status).toBe('draft');
    const again = await lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE });
    expect(again).toMatchObject({ looks_unchanged: 2, assets_created: 0, assets_updated: 0, pieces_created: 0, pieces_updated: 0 });
  });

  it('a row that fills the licence columns carries its own licence (the per-row override); a half-filled row is refused', async () => {
    const header = `${OWNED_HEADER},licence,commercial_reuse,territory,licence_expires,copyright_owner,acquisition,assignment_ref`;
    const text = `${header}\n${ownedRow('0303')},,,,,,,\n${ownedRow('0304')},TEST agency licence,no,IN,2027-06-30,Demo Agency (TEST),agency,TEST-AGENCY-9\n`;
    const s = await lib.importLibrary({ orgSlug: 'afflino', text });
    expect(s).toMatchObject({ looks_created: 2, licence_from_statement: 1 });
    expect(await asset('demo-vid-0303')).toMatchObject({ commercial_reuse: 'yes', territory: 'WW', licence_via: 'statement' });
    expect(await asset('demo-vid-0304')).toMatchObject({ license: 'TEST agency licence', commercial_reuse: 'no', territory: 'IN', acquisition: 'agency', assignment_ref: 'TEST-AGENCY-9', licence_via: 'import' });
    const before = await counts();
    const half = `${header}\n${ownedRow('0305')},,no,,,,,\n`;
    await expect(lib.importLibrary({ orgSlug: 'afflino', text: half })).rejects.toThrow(/licence is required with the licence columns/);
    expect(await counts()).toEqual(before);
  });

  it("a person's licence edit is never widened by a file; a file's narrowing still applies", async () => {
    const id = (await ctx.pool.query(`select id from assets where org_id = $1 and storage_key = 'demo-stills/0302.jpg'`, [ORG])).rows[0]!.id;
    // An editor narrows (anyone may): commercial reuse off.
    await editorial.updateAsset(ORG, { id: '00000000-0000-0000-0000-0000000c0002', role: 'editor' }, id, { commercial_reuse: 'no' });
    expect(await asset('demo-stills/0302.jpg')).toMatchObject({ commercial_reuse: 'no', licence_via: 'review' });
    const s = await lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE });
    expect(s.licence_kept).toEqual([{ kind: 'still', ref: 'demo-stills/0302.jpg', kept: ['commercial_reuse'] }]);
    expect(await asset('demo-stills/0302.jpg')).toMatchObject({ commercial_reuse: 'no', licence_via: 'review' });
    // A second run: the same answer, nothing written.
    const again = await lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE });
    expect(again).toMatchObject({ assets_updated: 0, licence_kept: [{ kind: 'still', ref: 'demo-stills/0302.jpg', kept: ['commercial_reuse'] }] });
    // The merge itself: the file's shorter licence applies, its wider territory and other chain of title do not.
    const cur = { license: 'A', commercial_reuse: 'yes' as const, territory: 'IN', expires_at: '2027-01-01T00:00:00.000Z', source_ref: null, copyright_owner: 'Demo Media (TEST)', author: null, acquisition: 'staff', assignment_ref: null, live_performance: false };
    const file = { ...cur, territory: 'AE', expires_at: '2026-12-01T00:00:00.000Z', live_performance: true, copyright_owner: 'Someone Else (TEST)' };
    expect(lib.mergeOverReviewed(cur, file)).toEqual({ facts: { ...file, copyright_owner: 'Demo Media (TEST)' }, kept: ['copyright_owner'] });
    const wider = { ...cur, commercial_reuse: 'yes' as const, expires_at: null, license: 'B' };
    expect(lib.mergeOverReviewed({ ...cur, commercial_reuse: 'no' }, wider).kept).toEqual(['commercial_reuse', 'expires_at', 'license']);
  });

  it('a new statement supersedes the old: the assets licensed by a statement move to it on the next import', async () => {
    const first = (await own.ownershipStatementFor(ORG))!;
    const { statement, superseded } = await own.recordOwnershipStatement(ORG, ADMIN, { copyright_owner: 'Demo Media Holdings (TEST)', acquisition: 'other' });
    expect(superseded).toBe(first.id);
    expect(statement.seq).toBe(first.seq + 1);
    expect(statement.statement).toMatch(/or by freelancers and agencies working for it/);
    const s = await lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE });
    expect(s.ownership_statement?.id).toBe(statement.id);
    expect(await asset('demo-vid-0301')).toMatchObject({ copyright_owner: 'Demo Media Holdings (TEST)', acquisition: 'other', assignment_ref: `owner-statement:${statement.id} ${statement.recorded_at.slice(0, 10)}`, licence_via: 'statement' });
    // 'other' needs the assignment reference: the statement is it, so the chain of title stays complete.
    const { chainOfTitleRefusals } = await import('@paparazzi/shared');
    expect(chainOfTitleRefusals((await asset('demo-stills/0301.jpg'))!)).toEqual([]);
  });

  it('recording or withdrawing waits for no import: refused while the library lock is held', async () => {
    const key = own.LIBRARY_LOCK_KEY(ORG);
    const held = await ctx.pool.query(`select pg_try_advisory_lock(hashtext($1)) as locked`, [key]);
    expect(held.rows[0]!.locked).toBe(true);
    try {
      await expect(own.recordOwnershipStatement(ORG, ADMIN, { copyright_owner: 'Demo Media (TEST)', acquisition: 'staff' })).rejects.toThrow(/a library import is running/);
      await expect(own.withdrawOwnershipStatement(ORG, ADMIN, 'TEST: counsel asked us to stop')).rejects.toThrow(/a library import is running/);
      await expect(lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE })).rejects.toThrow(/another library import is running/);
    } finally {
      await ctx.pool.query(`select pg_advisory_unlock(hashtext($1))`, [key]);
    }
  });

  it("withdrawing the statement narrows every asset it licensed at once; rows without licence columns are refused again", async () => {
    await expect(own.withdrawOwnershipStatement(ORG, ADMIN, 'short')).rejects.toThrow(/10-500 characters/);
    const out = await own.withdrawOwnershipStatement(ORG, ADMIN, 'TEST: counsel asked us to stop relying on it');
    // 0301 and 0303 (video + still each); 0302's still is a person's (review), its video the statement's.
    expect(out.assets_narrowed).toBe(5);
    expect(await asset('demo-vid-0301')).toMatchObject({ commercial_reuse: 'unknown', licence_via: 'statement' });
    expect(await asset('demo-vid-0304')).toMatchObject({ commercial_reuse: 'no', licence_via: 'import' });
    expect(await own.ownershipStatementFor(ORG)).toBeNull();
    const auditRow = await ctx.pool.query(`select action from audit_log where org_id = $1 and entity_id = $2`, [ORG, out.withdrawn]);
    expect(auditRow.rows).toEqual([{ action: 'library.ownership_withdrawn' }]);
    await expect(own.withdrawOwnershipStatement(ORG, ADMIN, 'TEST: a second withdrawal')).rejects.toThrow(/no ownership statement is in force/);
    await expect(lib.importLibrary({ orgSlug: 'afflino', text: OWNED_FILE })).rejects.toThrow(/no licence: /);
  });
});
