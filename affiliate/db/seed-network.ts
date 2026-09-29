/**
 * Network seed — Afflino's own in-house publisher network.
 *
 * Afflino runs its own publisher network next to the third-party creators and
 * publishers who sign up through onboarding. This seed registers that network:
 * one organisation ("Afflino"), one approved publisher ("Afflino in-house
 * network"), four role users, and one approved property per entry of a network
 * file, each with an `owner_operated` verification. Optionally
 * (`--with-demo-programme`) a TEST-labelled merchant/programme/offer graph, one
 * published look per property and the placements, so the network and the shop
 * can mint sandbox links.
 *
 * The network file (YAML) lists the properties:
 *
 *   properties:
 *     - key: demo-ig                 # [a-z0-9-], unique; used in placement keys
 *       name: Demo Instagram         # unique, at most 80 characters; the demo look's title and source_page
 *       platform: instagram          # instagram | youtube | snapchat | telegram | web
 *       account: demo.afflino        # handle (social) or bare hostname (web)
 *       url: https://instagram.example.com/demo.afflino   # https; for web its host is the account
 *
 * `db/network.example.yaml` is the default and is TEST data only (reserved
 * example.com names). An operator's own file names real accounts; the seed
 * cannot tell a real account from a typo, so a url outside the reserved
 * example names (RFC 2606 / RFC 6761) is seeded with a warning on stderr, never
 * rejected (see `networkFromYaml`).
 *
 * Idempotent: every row is merged on a natural key (see `findOrInsert` and
 * the `on conflict` clauses), so a second run against the same database
 * creates zero new rows and converges descriptive columns (canonical_url,
 * fresh_until, cover_asset_id, ...). Status, roles and contract terms are set
 * on insert only. The whole seed runs in one transaction when invoked from
 * the CLI.
 *
 *   pnpm seed:network                          # org + users + publisher + properties
 *   pnpm seed:network -- --with-demo-programme # + TEST merchant/programme/offer/looks/placements
 *   pnpm seed:network -- --network /path/to/network.yaml
 *
 * Inputs (environment):
 *   DATABASE_URL          required for the CLI
 *   NETWORK_FILE          path to the network file (default db/network.example.yaml; --network wins)
 *   WEB_HOST              when set, also seeds a `web` property for the shop itself
 *                         (external_account_id = host, canonical_url https://<host>) and, with the
 *                         demo programme, the `network-shop-web` placement reported as
 *                         web_placement_id (--web-host wins)
 *   SEED_OWNER_EMAIL, SEED_OPERATOR_EMAIL, SEED_APPROVER_EMAIL, SEED_ADMIN_EMAIL
 *                         override the RFC 2606 placeholder addresses <role>@afflino.invalid
 *   NODE_ENV              production → refuses --with-demo-programme and the example network
 *                         file (TEST data), see `cliRefusal`
 *
 * Output: one JSON document on stdout with every id (progress and warnings go to stderr).
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
export type NetworkQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export const NETWORK_PLATFORMS = ['instagram', 'youtube', 'snapchat', 'telegram', 'web'] as const;
export type NetworkPlatform = (typeof NETWORK_PLATFORMS)[number];

/** `placements.channel` of a network property's placement, per platform. */
export const PLATFORM_CHANNEL: Readonly<Record<NetworkPlatform, string>> = {
  instagram: 'instagram_bio',
  youtube: 'youtube_description',
  snapchat: 'snapchat_profile',
  telegram: 'telegram_post',
  web: 'web_article',
};
export const SHOP_CHANNEL = 'shop_web';
export const SHOP_PLACEMENT_KEY = 'network-shop-web';

/** The placement key of a network property: `network-<key>-<channel>`. */
export function placementKeyFor(key: string, platform: NetworkPlatform): string {
  return `network-${key}-${PLATFORM_CHANNEL[platform]}`;
}

export interface NetworkProperty {
  /** Unique within the file, [a-z0-9-]; used in the placement key and the demo asset's storage key. */
  key: string;
  /** Unique display name, e.g. Demo Instagram — the demo look's title suffix and source_page. */
  name: string;
  platform: NetworkPlatform;
  /** Handle (social platforms, lower-cased, no leading @) or bare hostname (web) — external_account_id. */
  account: string;
  /** https URL of the property — canonical_url. */
  url: string;
}

export interface ParsedNetwork {
  properties: NetworkProperty[];
  /** Non-fatal findings (e.g. a url outside the reserved example names); the CLI prints them to stderr. */
  warnings: string[];
}

export interface SeedEmails {
  owner: string;
  operator: string;
  approver: string;
  admin: string;
}

export interface SeedNetworkOptions {
  properties: NetworkProperty[];
  withDemoProgramme?: boolean;
  /** Host of the consumer shop (WEB_HOST); null/undefined → no shop property. */
  webHost?: string | null;
  emails?: Partial<SeedEmails>;
  /** Clock override (tests). */
  now?: Date;
}

export interface NetworkUserSummary {
  id: string;
  email: string;
  role: string;
}

export interface NetworkPropertySummary {
  key: string;
  name: string;
  platform: NetworkPlatform;
  account: string;
  url: string;
  property_id: string;
  verification_id: string;
  /** Present only with the demo programme (placements need a campaign). */
  placement_id: string | null;
  look_id: string | null;
}

export interface ShopPropertySummary {
  host: string;
  property_id: string;
  verification_id: string;
  placement_id: string | null;
}

export interface DemoProgrammeSummary {
  merchant_id: string;
  programme_id: string;
  contract_id: string;
  product_id: string;
  variant_id: string;
  offer_id: string;
  campaign_id: string;
  looks: Array<{ key: string; look_id: string; asset_id: string; look_item_id: string }>;
}

export interface SeedNetworkSummary {
  org_id: string;
  org_slug: string;
  publisher_id: string;
  users: {
    publisher_owner: NetworkUserSummary;
    finance_operator: NetworkUserSummary;
    finance_approver: NetworkUserSummary;
    network_admin: NetworkUserSummary;
  };
  properties: NetworkPropertySummary[];
  shop_property: ShopPropertySummary | null;
  demo_programme: DemoProgrammeSummary | null;
  /** The shop's placement id, to use as WEB_PLACEMENT_ID (shop host + demo programme only). */
  web_placement_id?: string;
}

export const NETWORK_ORG_SLUG = 'afflino';
export const NETWORK_ORG_NAME = 'Afflino';
export const NETWORK_PUBLISHER_LEGAL_NAME = 'Afflino in-house network';
export const PLACEHOLDER_EMAIL_DOMAIN = 'afflino.invalid'; // RFC 2606

export const DEFAULT_EMAILS: SeedEmails = {
  owner: `publisher_owner@${PLACEHOLDER_EMAIL_DOMAIN}`,
  operator: `finance_operator@${PLACEHOLDER_EMAIL_DOMAIN}`,
  approver: `finance_approver@${PLACEHOLDER_EMAIL_DOMAIN}`,
  admin: `network_admin@${PLACEHOLDER_EMAIL_DOMAIN}`,
};

// TEST-labelled sandbox rows (invariant 11): "Demo …" names, example.com URLs.
const DEMO = {
  merchant: 'Demo Merchant (network sandbox)',
  programme: 'Demo Network Programme',
  connector: 'stub-network',
  allowedDomain: 'shop.example.com',
  brand: 'Demo Brand',
  model: 'Demo Network Tee',
  category: 'apparel',
  sku: 'DEMO-NETWORK-SKU-001',
  offerUrl: 'https://shop.example.com/p/demo-network-sku',
  priceMinor: 149900, // INR 1,499.00
  campaign: 'Demo Network Campaign',
  lookCategory: 'Fashion',
} as const;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function one(
  query: NetworkQuery,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> {
  const { rows } = await query(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`seed-network: expected one row from: ${sql.slice(0, 90)}…`);
  return row;
}

function idOf(row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('seed-network: row has no uuid id');
  return id;
}

/**
 * Merge-by-natural-key for tables without a unique constraint on that key:
 * select first, insert only when nothing matched, return the id either way.
 * Optional `update` converges mutable columns on the existing row.
 */
async function findOrInsert(
  query: NetworkQuery,
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
const KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HANDLE_RE = /^[a-z0-9_](?:[a-z0-9._-]{0,62}[a-z0-9_])?$/;
const PROPERTY_FIELDS = ['key', 'name', 'platform', 'account', 'url'] as const;

export function assertHostname(value: string, what: string): string {
  const v = value.trim().toLowerCase();
  if (!HOSTNAME_RE.test(v)) {
    throw new Error(`seed-network: ${what} must be a bare hostname (got '${value}')`);
  }
  return v;
}

/**
 * True for the names reserved for documentation and testing: example.com / .net / .org and
 * their subdomains (RFC 2606 §3) and the .example / .test / .invalid / .localhost TLDs
 * (RFC 2606 §2, RFC 6761).
 */
export function isReservedExampleHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (['example.com', 'example.net', 'example.org'].some((d) => h === d || h.endsWith(`.${d}`))) return true;
  const tld = h.split('.').pop() ?? '';
  return ['example', 'test', 'invalid', 'localhost'].includes(tld);
}

function isPlatform(v: string): v is NetworkPlatform {
  return (NETWORK_PLATFORMS as readonly string[]).includes(v);
}

/**
 * Validate + normalise a parsed network file.
 *
 * Rejected (throws, nothing is seeded): a missing or empty `properties:` list, a top-level key
 * other than `properties`, a field other than key / name / platform / account / url, a missing
 * or empty field, a key outside [a-z0-9-] (1–40 chars, no leading/trailing hyphen), a name
 * longer than 80 characters, a platform
 * outside instagram | youtube | snapchat | telegram | web, a web account that is not a bare
 * hostname or a social handle outside [a-z0-9._-], a url that is not https (or carries
 * credentials), a web property whose url host differs from its account, and any duplicate key,
 * name (case-insensitive) or platform + account pair.
 *
 * Warned (returned in `warnings`, still seeded): a url whose host is not a reserved example
 * name. The example file must produce none (tested); an operator's own file lists real
 * accounts, which the seed has no way to verify.
 */
export function networkFromYaml(doc: unknown, source = 'network file'): ParsedNetwork {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`seed-network: ${source} must be a mapping with a 'properties:' list`);
  }
  for (const k of Object.keys(doc)) {
    if (k !== 'properties') {
      throw new Error(`seed-network: ${source} has an unknown top-level key '${k}' (only 'properties')`);
    }
  }
  const list = (doc as { properties?: unknown }).properties;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`seed-network: ${source} has no non-empty 'properties:' list`);
  }

  const warnings: string[] = [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const seenAccounts = new Set<string>();
  const properties = list.map((raw, i): NetworkProperty => {
    const at = `${source} properties[${i}]`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`seed-network: ${at} must be a mapping of ${PROPERTY_FIELDS.join(', ')}`);
    }
    const p = raw as Record<string, unknown>;
    for (const k of Object.keys(p)) {
      if (!(PROPERTY_FIELDS as readonly string[]).includes(k)) {
        throw new Error(`seed-network: ${at} has an unknown field '${k}' (allowed: ${PROPERTY_FIELDS.join(', ')})`);
      }
    }
    const field = (k: (typeof PROPERTY_FIELDS)[number]): string => {
      const v = p[k];
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) throw new Error(`seed-network: ${at} is missing '${k}' (needs ${PROPERTY_FIELDS.join(', ')})`);
      return s;
    };

    const key = field('key');
    if (!KEY_RE.test(key)) {
      throw new Error(
        `seed-network: ${at}.key '${key}' must be 1-40 lower-case letters, digits or hyphens, ` +
          'starting and ending with a letter or digit',
      );
    }
    const name = field('name');
    if (name.length > 80) throw new Error(`seed-network: ${at}.name is longer than 80 characters`);

    const platformRaw = field('platform').toLowerCase();
    if (!isPlatform(platformRaw)) {
      throw new Error(
        `seed-network: ${at}.platform '${platformRaw}' is not one of ${NETWORK_PLATFORMS.join(' | ')}`,
      );
    }
    const platform = platformRaw;

    const accountRaw = field('account');
    let account: string;
    if (platform === 'web') {
      account = assertHostname(accountRaw, `${at}.account (platform web)`);
    } else {
      account = accountRaw.replace(/^@/, '').toLowerCase();
      if (!HANDLE_RE.test(account)) {
        throw new Error(
          `seed-network: ${at}.account '${accountRaw}' must be a handle of letters, digits, '.', '_' or '-'`,
        );
      }
    }

    const url = field('url');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`seed-network: ${at}.url '${url}' is not a URL`);
    }
    if (parsed.protocol !== 'https:') throw new Error(`seed-network: ${at}.url must be https (got '${url}')`);
    if (parsed.username || parsed.password) throw new Error(`seed-network: ${at}.url must not carry credentials`);
    const urlHost = parsed.hostname.toLowerCase();
    if (platform === 'web' && urlHost !== account) {
      throw new Error(`seed-network: ${at}.url host '${urlHost}' must equal the web account '${account}'`);
    }
    if (!isReservedExampleHost(urlHost)) {
      warnings.push(
        `${at} (${key}): url host '${urlHost}' is not a reserved example name; ` +
          'it is seeded as a real property the operator runs',
      );
    }

    if (seenKeys.has(key)) throw new Error(`seed-network: ${source} has a duplicate key '${key}'`);
    if (seenNames.has(name.toLowerCase())) throw new Error(`seed-network: ${source} has a duplicate name '${name}'`);
    const accountKey = `${platform}/${account}`;
    if (seenAccounts.has(accountKey)) {
      throw new Error(`seed-network: ${source} lists ${accountKey} twice`);
    }
    seenKeys.add(key);
    seenNames.add(name.toLowerCase());
    seenAccounts.add(accountKey);
    return { key, name, platform, account, url };
  });
  return { properties, warnings };
}

// ---------------------------------------------------------------------------
// the seed
// ---------------------------------------------------------------------------
export async function seedNetwork(query: NetworkQuery, opts: SeedNetworkOptions): Promise<SeedNetworkSummary> {
  if (opts.properties.length === 0) throw new Error('seed-network: at least one property is required');
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const freshUntil = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const emails: SeedEmails = { ...DEFAULT_EMAILS, ...stripUndefined(opts.emails ?? {}) };
  const webHost = opts.webHost ? assertHostname(opts.webHost, 'WEB_HOST') : null;
  if (webHost && opts.properties.some((p) => p.platform === 'web' && p.account === webHost)) {
    throw new Error(
      `seed-network: WEB_HOST '${webHost}' is also a web property in the network file; the shop needs its own host`,
    );
  }

  // -- organisation -----------------------------------------------------------
  const orgId = idOf(
    await one(
      query,
      `insert into organisations (name, slug)
       values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [NETWORK_ORG_NAME, NETWORK_ORG_SLUG],
    ),
  );

  // -- users + memberships ----------------------------------------------------
  async function seedUser(email: string, displayName: string, role: string): Promise<NetworkUserSummary> {
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
    // Report the role the database holds, not the one asked for: after an operator changes it,
    // the summary says so.
    const stored = await one(query, `select role from memberships where user_id = $1 and org_id = $2`, [id, orgId]);
    if (typeof stored.role !== 'string') throw new Error(`seed-network: membership of ${email} has no role`);
    return { id, email, role: stored.role };
  }

  const users = {
    publisher_owner: await seedUser(emails.owner, 'Afflino — publisher owner', 'publisher_owner'),
    finance_operator: await seedUser(emails.operator, 'Afflino — finance operator', 'finance_operator'),
    finance_approver: await seedUser(emails.approver, 'Afflino — finance approver', 'finance_approver'),
    network_admin: await seedUser(emails.admin, 'Afflino — network admin', 'network_admin'),
  };

  // -- publisher (the operator itself: approved + active on purpose) ----------
  const publisher = await findOrInsert(
    query,
    {
      sql: `select id from publishers where org_id = $1 and legal_name = $2 limit 1`,
      params: [orgId, NETWORK_PUBLISHER_LEGAL_NAME],
    },
    {
      sql: `insert into publishers (org_id, legal_name, country, status, onboarding_state)
            values ($1, $2, 'IN', 'approved', 'active')
            returning id`,
      params: [orgId, NETWORK_PUBLISHER_LEGAL_NAME],
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
  async function seedProperty(
    platform: string,
    account: string,
    canonicalUrl: string,
  ): Promise<{ propertyId: string; verificationId: string }> {
    // (platform, external_account_id) is unique across ALL orgs. The update is guarded to this org, so
    // an account another organisation already owns is never taken over (zero rows → loud error), and
    // status is set on insert only, so a re-run never lifts a suspension.
    const propertyRes = await query(
      `insert into properties (org_id, publisher_id, platform, external_account_id, canonical_url, status)
       values ($1, $2, $3, $4, $5, 'approved')
       on conflict (platform, external_account_id)
         do update set publisher_id = excluded.publisher_id,
                       canonical_url = excluded.canonical_url
         where properties.org_id = excluded.org_id
       returning id`,
      [orgId, publisherId, platform, account, canonicalUrl],
    );
    if (!propertyRes.rows[0]) {
      throw new Error(
        `seed-network: property ${platform}/${account} already belongs to another organisation; refusing to take it over`,
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

  const properties: NetworkPropertySummary[] = [];
  for (const p of opts.properties) {
    const { propertyId, verificationId } = await seedProperty(p.platform, p.account, p.url);
    properties.push({
      key: p.key,
      name: p.name,
      platform: p.platform,
      account: p.account,
      url: p.url,
      property_id: propertyId,
      verification_id: verificationId,
      placement_id: null,
      look_id: null,
    });
  }

  let shopProperty: ShopPropertySummary | null = null;
  if (webHost) {
    const { propertyId, verificationId } = await seedProperty('web', webHost, `https://${webHost}`);
    shopProperty = { host: webHost, property_id: propertyId, verification_id: verificationId, placement_id: null };
  }

  // -- optional TEST-labelled demo programme -------------------------------------
  let demo: DemoProgrammeSummary | null = null;
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
          `seed-network: placement_key ${placementKey} already belongs to another organisation; refusing to take it over`,
        );
      }
      return idOf(res.rows[0]);
    }

    const looks: DemoProgrammeSummary['looks'] = [];
    for (const p of opts.properties) {
      const summary = properties.find((s) => s.key === p.key);
      if (!summary) throw new Error(`seed-network: property summary missing for ${p.key}`);
      const storageKey = `demo/network/${p.key}.jpg`;

      const asset = await findOrInsert(
        query,
        {
          sql: `select id from assets where org_id = $1 and storage_key = $2 limit 1`,
          params: [orgId, storageKey],
        },
        {
          sql: `insert into assets (org_id, storage_key, license, territory)
                values ($1, $2, 'owned', 'IN') returning id`,
          params: [orgId, storageKey],
        },
        {
          sql: `update assets set license = 'owned', territory = 'IN' where org_id = $1 and id = $2`,
          params: (id) => [orgId, id],
        },
      );

      const lookTitle = `Demo look — ${p.name}`;
      const look = await findOrInsert(
        query,
        { sql: `select id from looks where org_id = $1 and title = $2 limit 1`, params: [orgId, lookTitle] },
        {
          sql: `insert into looks
                  (org_id, title, locale, category, status, published_at, source_page, sponsored, cover_asset_id)
                values ($1, $2, 'en', $3, 'published', $4::timestamptz, $5, false, $6)
                returning id`,
          params: [orgId, lookTitle, DEMO.lookCategory, nowIso, p.name, asset.id],
        },
        {
          // status is set on insert only: a paused or withdrawn look (e.g. a rights takedown) stays so.
          sql: `update looks
                   set locale = 'en', category = $3,
                       published_at = coalesce(published_at, $4::timestamptz),
                       source_page = $5, sponsored = false, cover_asset_id = $6
                 where org_id = $1 and id = $2`,
          params: (id) => [orgId, id, DEMO.lookCategory, nowIso, p.name, asset.id],
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
      summary.placement_id = await seedPlacement(
        summary.property_id,
        placementKeyFor(p.key, p.platform),
        PLATFORM_CHANNEL[p.platform],
      );
      looks.push({ key: p.key, look_id: look.id, asset_id: asset.id, look_item_id: lookItem.id });
    }

    if (shopProperty) {
      shopProperty.placement_id = await seedPlacement(shopProperty.property_id, SHOP_PLACEMENT_KEY, SHOP_CHANNEL);
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

  const summary: SeedNetworkSummary = {
    org_id: orgId,
    org_slug: NETWORK_ORG_SLUG,
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
export interface NetworkCliArgs {
  networkPath: string;
  withDemoProgramme: boolean;
  webHost: string | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_NETWORK_FILE = path.resolve(here, 'network.example.yaml');

export const USAGE =
  'usage: tsx db/seed-network.ts [--network <network.yaml>] [--with-demo-programme] [--web-host <host>]';

function nonEmpty(v: string | undefined): string | null {
  return v !== undefined && v.trim() !== '' ? v.trim() : null;
}

/** Hand-rolled flag parsing (no new dependencies). Flags win over NETWORK_FILE / WEB_HOST. */
export function parseNetworkArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): NetworkCliArgs {
  let networkPath = nonEmpty(env.NETWORK_FILE) ?? DEFAULT_NETWORK_FILE;
  let withDemoProgramme = false;
  let webHost: string | null = nonEmpty(env.WEB_HOST);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // pnpm forwards a literal `--` (pnpm seed:network -- --with-demo-programme); ignore it.
    if (a === '--') continue;
    if (a === '--with-demo-programme') withDemoProgramme = true;
    else if (a === '--network') {
      const v = argv[i + 1];
      if (!v) throw new Error('seed-network: --network needs a path');
      networkPath = v;
      i += 1;
    } else if (a?.startsWith('--network=')) networkPath = a.slice('--network='.length);
    else if (a === '--web-host') {
      const v = argv[i + 1];
      if (!v) throw new Error('seed-network: --web-host needs a hostname');
      webHost = v;
      i += 1;
    } else if (a?.startsWith('--web-host=')) webHost = a.slice('--web-host='.length);
    else if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`seed-network: unknown argument '${a}'`);
  }
  if (networkPath.trim() === '') throw new Error('seed-network: --network needs a path');
  return { networkPath: path.resolve(networkPath), withDemoProgramme, webHost: nonEmpty(webHost ?? undefined) };
}

/** Read + parse + validate a network file (YAML). */
export async function loadNetworkFile(networkPath: string): Promise<ParsedNetwork> {
  const require = createRequire(path.join(here, 'seed-network.ts'));
  // Borrow the api package's yaml parser (repo root has no dependencies).
  const YAML = require('../packages/api/node_modules/yaml') as { parse(text: string): unknown };
  const text = await readFile(networkPath, 'utf8');
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (err) {
    throw new Error(`seed-network: ${networkPath} is not valid YAML: ${err instanceof Error ? err.message : err}`);
  }
  return networkFromYaml(doc, networkPath);
}

/**
 * Why the CLI must not run with these arguments, or null. Checked before the network file is
 * read or the database is touched. Under NODE_ENV=production the seed refuses the TEST demo
 * programme and the TEST example network file (so a re-run that lost NETWORK_FILE fails instead
 * of seeding the example's properties into the real organisation as approved).
 */
export function cliRefusal(args: NetworkCliArgs, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== 'production') return null;
  if (args.withDemoProgramme) {
    return 'REFUSING: --with-demo-programme seeds TEST-labelled sandbox rows and must never run with NODE_ENV=production';
  }
  if (args.networkPath === DEFAULT_NETWORK_FILE) {
    return (
      `REFUSING: the example network file (${DEFAULT_NETWORK_FILE}) is TEST data and must never be seeded ` +
      'with NODE_ENV=production; pass --network or NETWORK_FILE'
    );
  }
  return null;
}

/** Notices printed to stderr before the seed runs (exported for tests). */
export function cliNotices(args: NetworkCliArgs): string[] {
  const notices: string[] = [];
  if (args.withDemoProgramme && !args.webHost) {
    notices.push(
      'seed-network: no WEB_HOST: no shop placement, so no web_placement_id ' +
        "(set WEB_HOST or --web-host to the shop's public hostname to get one)",
    );
  }
  return notices;
}

const isMainEntry =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  main().catch((err) => {
    console.error('seed-network failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const args = parseNetworkArgs(process.argv.slice(2));
  const refusal = cliRefusal(args);
  if (refusal) throw new Error(refusal);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required: seed-network targets a real Postgres (see db/README.md)');
  }

  const network = await loadNetworkFile(args.networkPath);
  const count = network.properties.length;
  console.error(
    `seed-network: ${count} ${count === 1 ? 'property' : 'properties'} from ${args.networkPath}` +
      (args.webHost ? `, shop host ${args.webHost}` : '') +
      (args.withDemoProgramme ? ', with TEST demo programme' : ''),
  );
  for (const w of network.warnings) console.error(`seed-network: warning: ${w}`);
  for (const n of cliNotices(args)) console.error(n);

  const require = createRequire(path.join(here, 'seed-network.ts'));
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
    const summary = await seedNetwork((sql, params) => client.query(sql, params ?? []), {
      properties: network.properties,
      withDemoProgramme: args.withDemoProgramme,
      webHost: args.webHost,
      emails: {
        owner: process.env.SEED_OWNER_EMAIL,
        operator: process.env.SEED_OPERATOR_EMAIL,
        approver: process.env.SEED_APPROVER_EMAIL,
        admin: process.env.SEED_ADMIN_EMAIL,
      },
    });
    await client.query('COMMIT');
    console.log(JSON.stringify(summary, null, 2));
    if (summary.shop_property && !summary.web_placement_id) {
      console.error(
        'seed-network: shop property seeded but no placement (placements need a campaign): ' +
          (process.env.NODE_ENV === 'production'
            ? 'no web_placement_id until a real programme is contracted (--with-demo-programme is refused in production)'
            : 'add --with-demo-programme to get web_placement_id'),
      );
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}
