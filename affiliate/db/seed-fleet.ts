/**
 * Fleet seed — the in-house publisher network.
 *
 * The owner's five WordPress news sites (autopub/config/sites.yaml) are the
 * platform's first publisher: one organisation, one approved publisher, one
 * approved `web` property per site, each with an `owner_operated`
 * verification. Optionally (`--with-demo-programme`) a TEST-labelled
 * merchant/programme/offer graph so the sites can mint sandbox links.
 *
 * Idempotent: every row is merged on a natural key (see `findOrInsert` and
 * the `on conflict` clauses), so a second run against the same database
 * creates zero new rows and converges mutable columns (status, canonical_url,
 * fresh_until, cover_asset_id, ...). The whole seed runs in one transaction
 * when invoked from the CLI.
 *
 *   pnpm seed:fleet                          # org + users + publisher + properties
 *   pnpm seed:fleet -- --with-demo-programme # + TEST merchant/programme/offer/looks/placements
 *   pnpm seed:fleet -- --sites /path/to/sites.yaml
 *
 * Inputs (environment):
 *   DATABASE_URL          required for the CLI
 *   FLEET_SITES_YAML      path to sites.yaml (default ../../autopub/config/sites.yaml; --sites wins)
 *   FLEET_OWNER_EMAIL, FLEET_OPERATOR_EMAIL, FLEET_APPROVER_EMAIL, FLEET_ADMIN_EMAIL
 *                         override the RFC 2606 placeholder addresses <role>@marketing-fleet.invalid
 *   AFFILIATE_WEB_HOST    when set, also seeds a `web` property for the shop itself
 *                         (external_account_id = host, canonical_url https://<host>) and, with the
 *                         demo programme, the `fleet-shop-web` placement reported as web_placement_id
 *
 * Output: one JSON document on stdout with every id (progress goes to stderr).
 *
 * The `yaml` parser and the `pg` driver are borrowed from the api package's
 * node_modules via createRequire (same pattern as db/migrate.mjs); the repo
 * root has no dependencies of its own.
 *
 * Deliberate shortcut, documented in db/README.md: the publisher is created
 * directly as status 'approved' / onboarding_state 'active', skipping the
 * onboarding state machine — the publisher IS the operator, so there is no
 * counterparty to review it.
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Minimal query surface: satisfied by pg.Client, pg.Pool and pg-mem's adapter. */
export type FleetQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export interface FleetSite {
  /** sites.yaml `key`, e.g. MENTALIST — used for storage keys and placement keys (lower-cased). */
  key: string;
  /** Bare hostname, e.g. marketingmentalist.in — the property's external_account_id. */
  domain: string;
  /** Display name, e.g. Marketing Mentalist — the demo look's source_page. */
  name: string;
}

export interface FleetEmails {
  owner: string;
  operator: string;
  approver: string;
  admin: string;
}

export interface SeedFleetOptions {
  sites: FleetSite[];
  withDemoProgramme?: boolean;
  /** Host of the consumer shop (AFFILIATE_WEB_HOST); null/undefined → no shop property. */
  webHost?: string | null;
  emails?: Partial<FleetEmails>;
  /** Clock override (tests). */
  now?: Date;
}

export interface FleetUserSummary {
  id: string;
  email: string;
  role: string;
}

export interface FleetPropertySummary {
  key: string;
  name: string;
  domain: string;
  property_id: string;
  verification_id: string;
  /** Present only with the demo programme (placements need a campaign). */
  placement_id: string | null;
  look_id: string | null;
}

export interface FleetShopPropertySummary {
  host: string;
  property_id: string;
  verification_id: string;
  placement_id: string | null;
}

export interface FleetDemoProgrammeSummary {
  merchant_id: string;
  programme_id: string;
  contract_id: string;
  product_id: string;
  variant_id: string;
  offer_id: string;
  campaign_id: string;
  looks: Array<{ key: string; look_id: string; asset_id: string; look_item_id: string }>;
}

export interface SeedFleetSummary {
  org_id: string;
  org_slug: string;
  publisher_id: string;
  users: {
    publisher_owner: FleetUserSummary;
    finance_operator: FleetUserSummary;
    finance_approver: FleetUserSummary;
    network_admin: FleetUserSummary;
  };
  properties: FleetPropertySummary[];
  shop_property: FleetShopPropertySummary | null;
  demo_programme: FleetDemoProgrammeSummary | null;
  /** The shop's placement id, to use as WEB_PLACEMENT_ID (shop host + demo programme only). */
  web_placement_id?: string;
}

export const FLEET_ORG_SLUG = 'marketing-fleet';
export const FLEET_ORG_NAME = 'Marketing Fleet';
export const FLEET_PUBLISHER_LEGAL_NAME = 'Marketing Fleet (in-house)';
export const FLEET_PLACEHOLDER_DOMAIN = 'marketing-fleet.invalid'; // RFC 2606

export const DEFAULT_EMAILS: FleetEmails = {
  owner: `publisher_owner@${FLEET_PLACEHOLDER_DOMAIN}`,
  operator: `finance_operator@${FLEET_PLACEHOLDER_DOMAIN}`,
  approver: `finance_approver@${FLEET_PLACEHOLDER_DOMAIN}`,
  admin: `network_admin@${FLEET_PLACEHOLDER_DOMAIN}`,
};

// TEST-labelled sandbox rows (invariant 11): "Demo …" names, example.com URLs.
const DEMO = {
  merchant: 'Demo Merchant (fleet sandbox)',
  programme: 'Demo Fleet Programme',
  connector: 'stub-network',
  allowedDomain: 'shop.example.com',
  brand: 'Demo Brand',
  model: 'Demo Fleet Tee',
  category: 'apparel',
  sku: 'DEMO-FLEET-SKU-001',
  offerUrl: 'https://shop.example.com/p/demo-fleet-sku',
  priceMinor: 149900, // INR 1,499.00
  campaign: 'Demo Fleet Campaign',
  lookCategory: 'Fashion',
} as const;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function one(
  query: FleetQuery,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> {
  const { rows } = await query(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`seed-fleet: expected one row from: ${sql.slice(0, 90)}…`);
  return row;
}

function idOf(row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('seed-fleet: row has no uuid id');
  return id;
}

/**
 * Merge-by-natural-key for tables without a unique constraint on that key:
 * select first, insert only when nothing matched, return the id either way.
 * Optional `update` converges mutable columns on the existing row.
 */
async function findOrInsert(
  query: FleetQuery,
  select: { sql: string; params: unknown[] },
  insert: { sql: string; params: unknown[] },
  update?: { sql: string; params: (id: string) => unknown[] },
): Promise<{ id: string; created: boolean }> {
  const found = await query(select.sql, select.params);
  const existing = found.rows[0];
  if (existing) {
    const id = idOf(existing);
    if (update) await query(update.sql, update.params(id));
    return { id, created: false };
  }
  return { id: idOf(await one(query, insert.sql, insert.params)), created: true };
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function assertHostname(value: string, what: string): string {
  const v = value.trim().toLowerCase();
  if (!HOSTNAME_RE.test(v)) {
    throw new Error(`seed-fleet: ${what} must be a bare hostname (got '${value}')`);
  }
  return v;
}

/** Validate + normalise the `sites:` block of sites.yaml. */
export function sitesFromYaml(doc: unknown, source = 'sites.yaml'): FleetSite[] {
  const sites = (doc as { sites?: unknown } | null)?.sites;
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error(`seed-fleet: ${source} has no non-empty 'sites:' list`);
  }
  const seenKeys = new Set<string>();
  const seenDomains = new Set<string>();
  return sites.map((raw, i) => {
    const s = raw as Record<string, unknown>;
    const key = typeof s.key === 'string' ? s.key.trim() : '';
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    const domainRaw = typeof s.domain === 'string' ? s.domain.trim() : '';
    if (!key || !name || !domainRaw) {
      throw new Error(`seed-fleet: ${source} sites[${i}] needs key, domain and name`);
    }
    if (!/^[A-Za-z0-9_]+$/.test(key)) {
      throw new Error(`seed-fleet: ${source} sites[${i}].key '${key}' must be [A-Za-z0-9_]`);
    }
    const domain = assertHostname(domainRaw, `${source} sites[${i}].domain`);
    if (seenKeys.has(key.toLowerCase())) throw new Error(`seed-fleet: duplicate site key '${key}'`);
    if (seenDomains.has(domain)) throw new Error(`seed-fleet: duplicate site domain '${domain}'`);
    seenKeys.add(key.toLowerCase());
    seenDomains.add(domain);
    return { key, domain, name };
  });
}

// ---------------------------------------------------------------------------
// the seed
// ---------------------------------------------------------------------------
export async function seedFleet(query: FleetQuery, opts: SeedFleetOptions): Promise<SeedFleetSummary> {
  if (opts.sites.length === 0) throw new Error('seed-fleet: at least one site is required');
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const freshUntil = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const emails: FleetEmails = { ...DEFAULT_EMAILS, ...stripUndefined(opts.emails ?? {}) };
  const webHost = opts.webHost ? assertHostname(opts.webHost, 'AFFILIATE_WEB_HOST') : null;

  // -- organisation -----------------------------------------------------------
  const orgId = idOf(
    await one(
      query,
      `insert into organisations (name, slug)
       values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [FLEET_ORG_NAME, FLEET_ORG_SLUG],
    ),
  );

  // -- users + memberships ----------------------------------------------------
  async function seedUser(email: string, displayName: string, role: string): Promise<FleetUserSummary> {
    const id = idOf(
      await one(
        query,
        `insert into users (email, display_name)
         values ($1, $2)
         on conflict (email) do update set display_name = excluded.display_name
         returning id`,
        [email, displayName],
      ),
    );
    // role is set on insert only: a re-run never re-grants a role an operator changed.
    await query(
      `insert into memberships (user_id, org_id, role)
       values ($1, $2, $3)
       on conflict (user_id, org_id) do nothing`,
      [id, orgId, role],
    );
    return { id, email, role };
  }

  const users = {
    publisher_owner: await seedUser(emails.owner, 'Marketing Fleet — publisher owner', 'publisher_owner'),
    finance_operator: await seedUser(emails.operator, 'Marketing Fleet — finance operator', 'finance_operator'),
    finance_approver: await seedUser(emails.approver, 'Marketing Fleet — finance approver', 'finance_approver'),
    network_admin: await seedUser(emails.admin, 'Marketing Fleet — network admin', 'network_admin'),
  };

  // -- publisher (the operator itself: approved + active on purpose) ----------
  const publisher = await findOrInsert(
    query,
    {
      sql: `select id from publishers where org_id = $1 and legal_name = $2 limit 1`,
      params: [orgId, FLEET_PUBLISHER_LEGAL_NAME],
    },
    {
      sql: `insert into publishers (org_id, legal_name, country, status, onboarding_state)
            values ($1, $2, 'IN', 'approved', 'active')
            returning id`,
      params: [orgId, FLEET_PUBLISHER_LEGAL_NAME],
    },
    {
      // status / onboarding_state are set on insert only: a re-run never lifts a suspension.
      sql: `update publishers set country = 'IN'
            where org_id = $1 and id = $2`,
      params: (id) => [orgId, id],
    },
  );
  const publisherId = publisher.id;

  // -- properties + verifications ----------------------------------------------
  async function seedWebProperty(host: string): Promise<{ propertyId: string; verificationId: string }> {
    // (platform, external_account_id) is unique across ALL orgs. The update is guarded to this org, so
    // a hostname another organisation already owns is never taken over (zero rows → loud error), and
    // status is set on insert only, so a re-run never lifts a suspension.
    const propertyRes = await query(
      `insert into properties (org_id, publisher_id, platform, external_account_id, canonical_url, status)
       values ($1, $2, 'web', $3, $4, 'approved')
       on conflict (platform, external_account_id)
         do update set publisher_id = excluded.publisher_id,
                       canonical_url = excluded.canonical_url
         where properties.org_id = excluded.org_id
       returning id`,
      [orgId, publisherId, host, `https://${host}`],
    );
    if (!propertyRes.rows[0]) {
      throw new Error(
        `seed-fleet: property web/${host} already belongs to another organisation; refusing to take it over`,
      );
    }
    const propertyId = idOf(propertyRes.rows[0]);
    // One verification per property, created only when none exists yet.
    const verification = await findOrInsert(
      query,
      {
        sql: `select id from verifications where org_id = $1 and property_id = $2 order by created_at limit 1`,
        params: [orgId, propertyId],
      },
      {
        sql: `insert into verifications (org_id, property_id, method, verified_by, verified_at, expires_at)
              values ($1, $2, 'owner_operated', $3, $4::timestamptz, null)
              returning id`,
        params: [orgId, propertyId, users.network_admin.id, nowIso],
      },
    );
    return { propertyId, verificationId: verification.id };
  }

  const properties: FleetPropertySummary[] = [];
  for (const site of opts.sites) {
    const { propertyId, verificationId } = await seedWebProperty(site.domain);
    properties.push({
      key: site.key,
      name: site.name,
      domain: site.domain,
      property_id: propertyId,
      verification_id: verificationId,
      placement_id: null,
      look_id: null,
    });
  }

  let shopProperty: FleetShopPropertySummary | null = null;
  if (webHost) {
    const { propertyId, verificationId } = await seedWebProperty(webHost);
    shopProperty = { host: webHost, property_id: propertyId, verification_id: verificationId, placement_id: null };
  }

  // -- optional TEST-labelled demo programme -------------------------------------
  let demo: FleetDemoProgrammeSummary | null = null;
  if (opts.withDemoProgramme) {
    const merchant = await findOrInsert(
      query,
      { sql: `select id from merchants where org_id = $1 and name = $2 limit 1`, params: [orgId, DEMO.merchant] },
      { sql: `insert into merchants (org_id, name) values ($1, $2) returning id`, params: [orgId, DEMO.merchant] },
    );

    const programme = await findOrInsert(
      query,
      {
        sql: `select id from programmes where org_id = $1 and merchant_id = $2 and name = $3 limit 1`,
        params: [orgId, merchant.id, DEMO.programme],
      },
      {
        sql: `insert into programmes
                (org_id, merchant_id, connector, name, status,
                 attribution_window_days, validation_delay_days, returns_window_days,
                 commission_basis, effective_from)
              values ($1, $2, $3, $4, 'active', 30, 7, 30, 'order_value', $5::timestamptz)
              returning id`,
        params: [orgId, merchant.id, DEMO.connector, DEMO.programme, nowIso],
      },
      {
        // status is set on insert only: a re-run never undoes the kill switch (pause/resume).
        sql: `update programmes
                 set connector = $3,
                     attribution_window_days = 30, validation_delay_days = 7, returns_window_days = 30,
                     commission_basis = 'order_value'
               where org_id = $1 and id = $2`,
        params: (id) => [orgId, id, DEMO.connector],
      },
    );

    await query(
      `insert into programme_capabilities (programme_id, countries, currency, allowed_domains)
       values ($1, $2, 'INR', $3)
       on conflict (programme_id)
         do update set countries = excluded.countries,
                       currency = excluded.currency,
                       allowed_domains = excluded.allowed_domains`,
      [programme.id, ['IN'], [DEMO.allowedDomain]],
    );

    const contractId = idOf(
      await one(
        query,
        `insert into contracts
           (org_id, publisher_id, programme_id, version,
            publisher_share_bps, payout_threshold_minor, status, effective_from)
         values ($1, $2, $3, 1, 7000, 5000, 'approved', $4::timestamptz)
         on conflict (publisher_id, programme_id, version)
           -- no-op update so RETURNING yields the existing id: an existing contract version's
           -- terms and approval are never rewritten by a re-run
           do update set version = contracts.version
         returning id`,
        [orgId, publisherId, programme.id, nowIso],
      ),
    );

    const product = await findOrInsert(
      query,
      {
        sql: `select id from products where org_id = $1 and brand = $2 and model = $3 limit 1`,
        params: [orgId, DEMO.brand, DEMO.model],
      },
      {
        sql: `insert into products (org_id, brand, model, category) values ($1, $2, $3, $4) returning id`,
        params: [orgId, DEMO.brand, DEMO.model, DEMO.category],
      },
    );

    const variant = await findOrInsert(
      query,
      {
        sql: `select id from variants where org_id = $1 and product_id = $2 and merchant_sku = $3 limit 1`,
        params: [orgId, product.id, DEMO.sku],
      },
      {
        sql: `insert into variants (org_id, product_id, size_text, colour, merchant_sku)
              values ($1, $2, 'M', 'Black', $3) returning id`,
        params: [orgId, product.id, DEMO.sku],
      },
    );

    const offer = await findOrInsert(
      query,
      {
        sql: `select id from offers
               where org_id = $1 and variant_id = $2 and programme_id = $3 and offer_url = $4
               limit 1`,
        params: [orgId, variant.id, programme.id, DEMO.offerUrl],
      },
      {
        sql: `insert into offers
                (org_id, variant_id, programme_id, merchant_id,
                 price_minor, currency, offer_url, fresh_until, status)
              values ($1, $2, $3, $4, $5, 'INR', $6, $7::timestamptz, 'active')
              returning id`,
        params: [orgId, variant.id, programme.id, merchant.id, DEMO.priceMinor, DEMO.offerUrl, freshUntil],
      },
      {
        // Re-running refreshes the offer so it stays mintable for another 30 days. status is set on
        // insert only: a revoked offer stays revoked.
        sql: `update offers set price_minor = $3, currency = 'INR', fresh_until = $4::timestamptz
               where org_id = $1 and id = $2`,
        params: (id) => [orgId, id, DEMO.priceMinor, freshUntil],
      },
    );

    const campaign = await findOrInsert(
      query,
      {
        sql: `select id from campaigns
               where org_id = $1 and publisher_id = $2 and programme_id = $3 and name = $4 limit 1`,
        params: [orgId, publisherId, programme.id, DEMO.campaign],
      },
      {
        sql: `insert into campaigns (org_id, publisher_id, programme_id, name)
              values ($1, $2, $3, $4) returning id`,
        params: [orgId, publisherId, programme.id, DEMO.campaign],
      },
    );

    async function seedPlacement(propertyId: string, placementKey: string, channel: string): Promise<string> {
      // placement_key is unique across ALL orgs: the update is guarded to this org (zero rows → loud error).
      const res = await query(
        `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
         values ($1, $2, $3, $4, $5)
         on conflict (placement_key)
           do update set campaign_id = excluded.campaign_id,
                         property_id = excluded.property_id,
                         channel = excluded.channel
           where placements.org_id = excluded.org_id
         returning id`,
        [orgId, campaign.id, propertyId, channel, placementKey],
      );
      if (!res.rows[0]) {
        throw new Error(
          `seed-fleet: placement_key ${placementKey} already belongs to another organisation; refusing to take it over`,
        );
      }
      return idOf(res.rows[0]);
    }

    const looks: FleetDemoProgrammeSummary['looks'] = [];
    for (const site of opts.sites) {
      const summary = properties.find((p) => p.key === site.key);
      if (!summary) throw new Error(`seed-fleet: property summary missing for ${site.key}`);
      const keyLower = site.key.toLowerCase();

      const asset = await findOrInsert(
        query,
        {
          sql: `select id from assets where org_id = $1 and storage_key = $2 limit 1`,
          params: [orgId, `demo/fleet/${keyLower}.jpg`],
        },
        {
          sql: `insert into assets (org_id, storage_key, license, territory)
                values ($1, $2, 'owned', 'IN') returning id`,
          params: [orgId, `demo/fleet/${keyLower}.jpg`],
        },
        {
          sql: `update assets set license = 'owned', territory = 'IN' where org_id = $1 and id = $2`,
          params: (id) => [orgId, id],
        },
      );

      const lookTitle = `Demo look — ${site.name}`;
      const look = await findOrInsert(
        query,
        { sql: `select id from looks where org_id = $1 and title = $2 limit 1`, params: [orgId, lookTitle] },
        {
          sql: `insert into looks
                  (org_id, title, locale, category, status, published_at, source_page, sponsored, cover_asset_id)
                values ($1, $2, 'en', $3, 'published', $4::timestamptz, $5, false, $6)
                returning id`,
          params: [orgId, lookTitle, DEMO.lookCategory, nowIso, site.name, asset.id],
        },
        {
          // status is set on insert only: a paused or withdrawn look (e.g. a rights takedown) stays so.
          sql: `update looks
                   set locale = 'en', category = $3,
                       published_at = coalesce(published_at, $4::timestamptz),
                       source_page = $5, sponsored = false, cover_asset_id = $6
                 where org_id = $1 and id = $2`,
          params: (id) => [orgId, id, DEMO.lookCategory, nowIso, site.name, asset.id],
        },
      );

      const lookItem = await findOrInsert(
        query,
        {
          sql: `select id from look_items
                 where org_id = $1 and look_id = $2 and asset_id = $3 and variant_id = $4 limit 1`,
          params: [orgId, look.id, asset.id, variant.id],
        },
        {
          sql: `insert into look_items (org_id, look_id, asset_id, variant_id, match_type)
                values ($1, $2, $3, $4, 'exact') returning id`,
          params: [orgId, look.id, asset.id, variant.id],
        },
      );

      summary.look_id = look.id;
      summary.placement_id = await seedPlacement(summary.property_id, `fleet-${keyLower}-web`, 'web_article');
      looks.push({ key: site.key, look_id: look.id, asset_id: asset.id, look_item_id: lookItem.id });
    }

    if (shopProperty) {
      shopProperty.placement_id = await seedPlacement(shopProperty.property_id, 'fleet-shop-web', 'shop_web');
    }

    demo = {
      merchant_id: merchant.id,
      programme_id: programme.id,
      contract_id: contractId,
      product_id: product.id,
      variant_id: variant.id,
      offer_id: offer.id,
      campaign_id: campaign.id,
      looks,
    };
  }

  const summary: SeedFleetSummary = {
    org_id: orgId,
    org_slug: FLEET_ORG_SLUG,
    publisher_id: publisherId,
    users,
    properties,
    shop_property: shopProperty,
    demo_programme: demo,
  };
  if (shopProperty?.placement_id) summary.web_placement_id = shopProperty.placement_id;
  return summary;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
export interface FleetCliArgs {
  sitesPath: string;
  withDemoProgramme: boolean;
  webHost: string | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SITES_YAML = path.resolve(here, '..', '..', 'autopub', 'config', 'sites.yaml');

/** Hand-rolled flag parsing (no new dependencies). */
export function parseFleetArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): FleetCliArgs {
  let sitesPath = env.FLEET_SITES_YAML && env.FLEET_SITES_YAML.trim() !== '' ? env.FLEET_SITES_YAML : DEFAULT_SITES_YAML;
  let withDemoProgramme = false;
  let webHost: string | null =
    env.AFFILIATE_WEB_HOST && env.AFFILIATE_WEB_HOST.trim() !== '' ? env.AFFILIATE_WEB_HOST.trim() : null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // pnpm forwards a literal `--` (pnpm seed:fleet -- --with-demo-programme); ignore it.
    if (a === '--') continue;
    if (a === '--with-demo-programme') withDemoProgramme = true;
    else if (a === '--sites') {
      const v = argv[i + 1];
      if (!v) throw new Error('seed-fleet: --sites needs a path');
      sitesPath = v;
      i += 1;
    } else if (a?.startsWith('--sites=')) sitesPath = a.slice('--sites='.length);
    else if (a === '--web-host') {
      const v = argv[i + 1];
      if (!v) throw new Error('seed-fleet: --web-host needs a hostname');
      webHost = v;
      i += 1;
    } else if (a?.startsWith('--web-host=')) webHost = a.slice('--web-host='.length);
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: tsx db/seed-fleet.ts [--sites <sites.yaml>] [--with-demo-programme] [--web-host <host>]',
      );
      process.exit(0);
    } else throw new Error(`seed-fleet: unknown argument '${a}'`);
  }
  return { sitesPath: path.resolve(sitesPath), withDemoProgramme, webHost };
}

export async function loadSites(sitesPath: string): Promise<FleetSite[]> {
  const require = createRequire(path.join(here, 'seed-fleet.ts'));
  // Borrow the api package's yaml parser (repo root has no dependencies).
  const YAML = require('../packages/api/node_modules/yaml') as { parse(text: string): unknown };
  const text = await readFile(sitesPath, 'utf8');
  return sitesFromYaml(YAML.parse(text), sitesPath);
}

const isMainEntry =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  main().catch((err) => {
    console.error('seed-fleet failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const args = parseFleetArgs(process.argv.slice(2));
  if (args.withDemoProgramme && process.env.NODE_ENV === 'production') {
    throw new Error(
      'REFUSING: --with-demo-programme seeds TEST-labelled sandbox rows and must never run with NODE_ENV=production',
    );
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required: seed-fleet targets a real Postgres (see db/README.md)');
  }

  const sites = await loadSites(args.sitesPath);
  console.error(
    `seed-fleet: ${sites.length} site(s) from ${args.sitesPath}` +
      (args.webHost ? `, shop host ${args.webHost}` : '') +
      (args.withDemoProgramme ? ', with TEST demo programme' : ''),
  );

  const require = createRequire(path.join(here, 'seed-fleet.ts'));
  const { Client } = require('../packages/api/node_modules/pg') as {
    Client: new (opts: { connectionString: string }) => {
      connect(): Promise<void>;
      query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
      end(): Promise<void>;
    };
  };

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const summary = await seedFleet((sql, params) => client.query(sql, params ?? []), {
      sites,
      withDemoProgramme: args.withDemoProgramme,
      webHost: args.webHost,
      emails: {
        owner: process.env.FLEET_OWNER_EMAIL,
        operator: process.env.FLEET_OPERATOR_EMAIL,
        approver: process.env.FLEET_APPROVER_EMAIL,
        admin: process.env.FLEET_ADMIN_EMAIL,
      },
    });
    await client.query('COMMIT');
    console.log(JSON.stringify(summary, null, 2));
    if (summary.shop_property && !summary.web_placement_id) {
      console.error(
        'seed-fleet: shop property seeded but no placement (placements need a campaign): ' +
          'add --with-demo-programme to get web_placement_id',
      );
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}
