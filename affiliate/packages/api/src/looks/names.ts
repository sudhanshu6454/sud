/**
 * Every celebrity's name, for the checks that keep a name off every text the
 * editors, the operators or the library write (the look's event, place and
 * piece labels, a product's brand / model / category, a storefront's slug,
 * name and bio, a public comment reply, an Amazon shelf's title). A name
 * appears on a page only in the credit line of that person's own look,
 * beside the non-endorsement line (@paparazzi/shared namedCelebrities): any
 * other text that names anyone is refused when written, and hidden when
 * read (a celebrity or alias added later matches text written before).
 *
 * `withheld` = nothing about the person may be shown now (unreviewed,
 * blocked, a minor, never-listed, under takedown: effectiveCelebrityRights
 * 'none'); the answers say which, so an editor sees why.
 */
import { effectiveCelebrityRights, namedCelebrities, type NamedCelebrity } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import type { Scoped } from './sql.js';

export interface CelebrityName extends NamedCelebrity {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  takedown_id: string | null;
  withheld: boolean;
}

interface Row {
  id: string;
  name: string;
  slug: string;
  aliases: string[] | null;
  rights_status: string;
  max_display: string;
  shoppable: boolean;
  is_minor: boolean;
  never_list: boolean;
  takedown_id: string | null;
}

const SQL = `select id, name, slug, aliases, rights_status, max_display, shoppable, is_minor, never_list, takedown_id
               from celebrities where org_id = $1 order by name, id`;

function toName(r: Row): CelebrityName {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    aliases: r.aliases ?? [],
    takedown_id: r.takedown_id,
    withheld: effectiveCelebrityRights(r).display === 'none',
  };
}

/** Every celebrity of the organisation (name, aliases, whether withheld). */
export async function celebrityNames(orgId: string, q?: Scoped): Promise<CelebrityName[]> {
  const rows = q ? (await q<Row>(SQL)).rows : (await tenantQuery<Row>(orgId, SQL)).rows;
  return rows.map(toName);
}

/** The celebrities any of `texts` names. */
export function namesIn(texts: Array<string | null | undefined>, names: readonly CelebrityName[]): CelebrityName[] {
  const out = new Map<string, CelebrityName>();
  for (const t of texts) for (const c of namedCelebrities(t, names)) out.set(c.id, c);
  return [...out.values()];
}

/** "names a celebrity (Demo Star Two, withheld)" — for an editor's error message. */
export function describeNames(found: readonly CelebrityName[]): string {
  return found.map((c) => `${c.name}${c.withheld ? ', withheld' : ''}`).join('; ');
}
