/**
 * Amazon.in Associates: tenant-scoped reads of the account behind an Amazon
 * programme (db/migrations/0006_amazon_associates.sql). Shared by link
 * minting (routes/links.ts), attribution (conversion-ingest.ts), the report
 * import and the setup CLI. `$1` is always the org_id (tenantQuery).
 */
import { tenantQuery } from '../db.js';

export interface AmazonAccount {
  id: string;
  org_id: string;
  programme_id: string;
  marketplace_host: string;
  store_id: string;
  account_ref: string;
  currency: string;
  disclosure_text: string;
  status: 'active' | 'disabled';
}

/**
 * No sub-tag and no third-party setting exists (0006): no click id ever goes
 * on an Amazon URL, and links go on owner-operated properties only.
 */
const ACCOUNT_COLS = `id, org_id, programme_id, marketplace_host, store_id, account_ref, currency,
  disclosure_text, status`;

function normalise(row: Record<string, unknown> | undefined): AmazonAccount | null {
  if (!row) return null;
  return { ...(row as unknown as AmazonAccount) };
}

/** The account behind a programme, or null when the programme is not an Amazon one. */
export async function amazonAccountForProgramme(orgId: string, programmeId: string): Promise<AmazonAccount | null> {
  const { rows } = await tenantQuery(
    orgId,
    `select ${ACCOUNT_COLS} from amazon_associates_accounts where org_id = $1 and programme_id = $2`,
    [programmeId],
  );
  return normalise(rows[0]);
}

export async function amazonAccountById(orgId: string, accountId: string): Promise<AmazonAccount | null> {
  const { rows } = await tenantQuery(
    orgId,
    `select ${ACCOUNT_COLS} from amazon_associates_accounts where org_id = $1 and id = $2`,
    [accountId],
  );
  return normalise(rows[0]);
}

/** By conversions.provider_account_id (= account_ref). */
export async function amazonAccountByRef(orgId: string, accountRef: string): Promise<AmazonAccount | null> {
  const { rows } = await tenantQuery(
    orgId,
    `select ${ACCOUNT_COLS} from amazon_associates_accounts where org_id = $1 and account_ref = $2`,
    [accountRef],
  );
  return normalise(rows[0]);
}

/** Every Amazon account of the organisation (the report route picks one when the body names none). */
export async function amazonAccountsOfOrg(orgId: string): Promise<AmazonAccount[]> {
  const { rows } = await tenantQuery(
    orgId,
    `select ${ACCOUNT_COLS} from amazon_associates_accounts where org_id = $1 order by created_at, id`,
  );
  return rows.map((r) => normalise(r) as AmazonAccount);
}

/** The placement's own tracking ID, or null (the redirect then uses the store ID). */
export async function placementTrackingId(orgId: string, accountId: string, placementId: string): Promise<string | null> {
  const { rows } = await tenantQuery<{ tracking_id: string }>(
    orgId,
    `select tracking_id from amazon_tracking_ids
      where org_id = $1 and account_id = $2 and placement_id = $3`,
    [accountId, placementId],
  );
  return rows[0]?.tracking_id ?? null;
}

/**
 * True when the property is approved and has a live owner_operated
 * verification (verified_at set, expires_at null or in the future) — the
 * verification db/seed-network.ts writes for every property of the
 * operator's own network.
 */
export async function propertyIsOwnerOperated(orgId: string, propertyId: string): Promise<boolean> {
  const { rows } = await tenantQuery<{ id: string }>(
    orgId,
    `select v.id
       from verifications v
       join properties p on p.id = v.property_id and p.org_id = $1
      where v.org_id = $1 and v.property_id = $2
        and v.method = 'owner_operated' and v.verified_at is not null
        and (v.expires_at is null or v.expires_at > now())
        and p.status = 'approved'
      limit 1`,
    [propertyId],
  );
  return rows.length > 0;
}
