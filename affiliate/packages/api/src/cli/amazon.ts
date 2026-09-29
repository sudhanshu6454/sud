/**
 * Amazon.in Associates operator CLI — ships in the api image
 * (node dist/cli/amazon.js …; in the repo: tsx src/cli/amazon.ts …).
 * DATABASE_URL is required; REDIS_URL (optional) lets `setup` clear the
 * redirect's cached routes whose tag changed. Output: one JSON document on
 * stdout; progress and refusals on stderr. Exit 0 ok, 1 refused / failed, 2
 * usage.
 *
 *   setup          --store-id <id>  (or AMAZON_STORE_ID)
 *                  --properties <file.csv>  (or AMAZON_PROPERTIES_FILE; platform,account,tracking_id:
 *                                             exactly the pages on the Associates website list)
 *                  [--publisher-share-bps <0..10000>]  (or AMAZON_PUBLISHER_SHARE_BPS; needed for a first contract)
 *                  [--status active|draft] [--org-slug afflino] [--shop-host <host>] (or WEB_HOST)
 *                  [--validation-delay-days <n>] [--returns-window-days <n>]
 *                  [--disclosure <text containing OA §10's statement word for word>]
 *                  There is no flag for third-party publishers and none for sub-tags: links go on
 *                  owner-operated Facebook / Instagram / web properties only, and no click id ever
 *                  goes on an Amazon URL.
 *   offers         --file <offers.csv> [--ttl-days 30] [--reactivate] [--org-slug afflino]
 *                  (asin_or_url,brand,model,category[,look][,size][,colour]); --reactivate also brings
 *                  back offers Amazon's product API reported not accessible
 *   import-report  --file <earnings report .tsv/.csv> [--account-id <uuid>] [--org-slug afflino]
 *   returns        [--org-slug afflino]   the returns an import left unmatched, with the sales each
 *                  could belong to (JSON)
 *   apply-return   --return-key <key> --conversion-id <uuid> [--org-slug afflino]   the operator's
 *                  choice for one of them (deterministic: a re-run does nothing)
 *   template       [--org-slug afflino]   a starting properties file (CSV on stdout): every approved
 *                  owner-operated Facebook / Instagram / web property (platform,account,tracking_id,url),
 *                  mapped IDs filled in
 *   links          [--org-slug afflino] [--format csv|json]   one tracked link per declared placement
 *                  with its own tracking ID × live Amazon offer, minted through POST /v1/links in this
 *                  process (JWT_SECRET, REDIRECT_BASE_URL); re-running mints nothing new. csv = the
 *                  link sheet on stdout, the summary on stderr. Exit 1 when any mint was refused.
 *   status         [--org-slug afflino]   counts for the check step (JSON)
 *   pause | resume [--org-slug afflino]   the programme's kill switch (POST /v1/programmes/:id/pause|resume
 *                  in this process, as the organisation's network_admin): every Amazon link serves the
 *                  paused page at once, and no new link can be minted, until resume
 *
 * Real values (store ID, tracking IDs, the declared properties) live in
 * files on the server, never in this repository; the repository's fixtures
 * are TEST values (demo-21, B0DEMO…), refused under NODE_ENV=production.
 */
import { readFile } from 'node:fs/promises';

const USAGE = `usage:
  amazon setup --store-id <id> --properties <file.csv> [--publisher-share-bps <n>]
               [--status active|draft] [--org-slug afflino] [--shop-host <host>]
               [--validation-delay-days <n>] [--returns-window-days <n>]
               [--disclosure <text>]
  amazon offers --file <offers.csv> [--ttl-days 30] [--reactivate] [--org-slug afflino]
  amazon import-report --file <report.tsv|csv> [--account-id <uuid>] [--org-slug afflino]
  amazon returns [--org-slug afflino]
  amazon apply-return --return-key <key> --conversion-id <uuid> [--org-slug afflino]
  amazon template [--org-slug afflino]
  amazon links [--org-slug afflino] [--format csv|json]
  amazon status [--org-slug afflino]
  amazon pause|resume [--org-slug afflino]`;

/** A command's output that is printed as it is (CSV), with its exit code. */
class RawOutput {
  constructor(
    readonly text: string,
    readonly code: number = 0,
  ) {}
}

class UsageError extends Error {}

type Flags = Map<string, string | true>;

const BOOLEAN_FLAGS = new Set(['reactivate', 'help']);

/** Flags that no longer exist, refused with the reason (not silently ignored). */
const REMOVED_FLAGS: Readonly<Record<string, string>> = {
  'all-owner-operated': 'removed: declare exactly the pages on the Associates website list in the properties file',
  'third-party-publishers-allowed': "removed: Amazon links go on the operator's own properties only (PR 9); nothing turns that off",
  'subtag-approval-ref': 'removed: no click id is ever put on an Amazon URL (LR: "Under no circumstances may you associate any sub-tag with a specific end user")',
  'subtag-param': 'removed: no click id is ever put on an Amazon URL',
};

export function parseFlags(argv: string[]): { command: string | null; flags: Flags } {
  const args = argv.filter((a) => a !== '--');
  const command = args[0] && !args[0].startsWith('--') ? args[0] : null;
  const flags: Flags = new Map();
  for (let i = command ? 1 : 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument '${a}'`);
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const removed = REMOVED_FLAGS[name];
    if (removed) throw new UsageError(`--${name}: ${removed}`);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = eq > 0 ? a.slice(eq + 1) : args[i + 1];
    if (value === undefined || (eq < 0 && value.startsWith('--'))) throw new UsageError(`--${name} needs a value`);
    flags.set(name, value);
    if (eq < 0) i += 1;
  }
  return { command, flags };
}

function str(flags: Flags, name: string, env?: string): string | undefined {
  const v = flags.get(name);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  const e = env ? process.env[env] : undefined;
  return e && e.trim() !== '' ? e.trim() : undefined;
}

function int(flags: Flags, name: string, env?: string): number | undefined {
  const v = str(flags, name, env);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name} must be a whole number`);
  return Number(v);
}

const stderrLog = {
  info: (obj: unknown, msg?: string) => console.error(`amazon: ${msg ?? ''} ${JSON.stringify(obj)}`),
  warn: (obj: unknown, msg?: string) => console.error(`amazon: warning: ${msg ?? ''} ${JSON.stringify(obj)}`),
};

async function runSetup(flags: Flags): Promise<unknown> {
  const { setupAmazonAssociates, parsePropertiesFile, SetupRefusal } = await import('../amazon/setup.js');
  const { deleteRouteKeys, __lastRouteCacheSecondDelete } = await import('../routes/programmes.js');
  const storeId = str(flags, 'store-id', 'AMAZON_STORE_ID');
  if (!storeId) throw new UsageError('--store-id (or AMAZON_STORE_ID) is required');
  const propertiesPath = str(flags, 'properties', 'AMAZON_PROPERTIES_FILE');
  if (!propertiesPath) throw new UsageError('--properties <file.csv> (or AMAZON_PROPERTIES_FILE) is required');
  const parsed = parsePropertiesFile(await readFile(propertiesPath, 'utf8'));
  if (parsed.problems.length > 0) throw new SetupRefusal(parsed.problems);
  const declarations = parsed.declarations;
  const status = str(flags, 'status');
  if (status !== undefined && status !== 'active' && status !== 'draft') throw new UsageError('--status is active or draft');
  return setupAmazonAssociates(
    {
      orgSlug: str(flags, 'org-slug') ?? 'afflino',
      storeId,
      declarations,
      publisherShareBps: int(flags, 'publisher-share-bps', 'AMAZON_PUBLISHER_SHARE_BPS') ?? null,
      programmeStatus: status as 'active' | 'draft' | undefined,
      disclosureText: str(flags, 'disclosure'),
      validationDelayDays: int(flags, 'validation-delay-days'),
      returnsWindowDays: int(flags, 'returns-window-days'),
      shopHost: str(flags, 'shop-host', 'WEB_HOST') ?? null,
    },
    {
      invalidate: async (tokens) => {
        const res = await deleteRouteKeys(tokens, stderrLog);
        await __lastRouteCacheSecondDelete();
        return res;
      },
    },
  );
}

async function runOffers(flags: Flags): Promise<unknown> {
  const { addAmazonOffers, parseOffersFile } = await import('../amazon/offers.js');
  const { SetupRefusal } = await import('../amazon/setup.js');
  const file = str(flags, 'file');
  if (!file) throw new UsageError('--file <offers.csv> is required');
  const parsed = parseOffersFile(await readFile(file, 'utf8'));
  if (parsed.problems.length > 0) throw new SetupRefusal(parsed.problems);
  return addAmazonOffers({
    orgSlug: str(flags, 'org-slug') ?? 'afflino',
    offers: parsed.offers,
    ttlDays: int(flags, 'ttl-days'),
    reactivate: flags.get('reactivate') === true,
  });
}

/** The organisation's one Amazon account (or the one named). */
async function oneAccount(flags: Flags) {
  const { getPool } = await import('../db.js');
  const { amazonAccountById, amazonAccountsOfOrg } = await import('../amazon/account.js');
  const slug = str(flags, 'org-slug') ?? 'afflino';
  const org = (await getPool().query<{ id: string }>(`select id from organisations where slug = $1`, [slug])).rows[0];
  if (!org) throw new Error(`no organisation '${slug}'`);
  const accountId = str(flags, 'account-id');
  const accounts = accountId ? [await amazonAccountById(org.id, accountId)].filter((a) => a !== null) : await amazonAccountsOfOrg(org.id);
  if (accounts.length !== 1 || !accounts[0]) {
    throw new Error(accounts.length === 0 ? `no Amazon Associates account in '${slug}'` : 'several accounts: pass --account-id');
  }
  return { orgId: org.id, account: accounts[0] };
}

async function runReturns(flags: Flags): Promise<unknown> {
  const { listUnmatchedReturns } = await import('../amazon/returns.js');
  const { orgId, account } = await oneAccount(flags);
  const unmatched = await listUnmatchedReturns(orgId, account);
  return { account_id: account.id, account_ref: account.account_ref, unmatched };
}

async function runApplyReturn(flags: Flags): Promise<unknown> {
  const returnKey = str(flags, 'return-key');
  const conversionId = str(flags, 'conversion-id');
  if (!returnKey || !conversionId) throw new UsageError('--return-key and --conversion-id are required');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversionId)) {
    throw new UsageError('--conversion-id must be a conversion uuid');
  }
  const { getPool } = await import('../db.js');
  const { applyUnmatchedReturn } = await import('../amazon/returns.js');
  const { orgId, account } = await oneAccount(flags);
  // The audit row names the organisation's first network_admin, as the kill switch does.
  const admin = (
    await getPool().query<{ user_id: string }>(
      `select user_id from memberships where org_id = $1 and role = 'network_admin' order by created_at, user_id limit 1`,
      [orgId],
    )
  ).rows[0];
  const out = await applyUnmatchedReturn(orgId, account, { returnKey, conversionId, actorId: admin?.user_id ?? null });
  if (out.kind === 'refused') throw new Error(`apply-return refused: ${out.reason}; nothing was written`);
  return { return_key: returnKey, ...out };
}

async function runImport(flags: Flags): Promise<unknown> {
  const file = str(flags, 'file');
  if (!file) throw new UsageError('--file <report> is required');
  const { importAmazonEarningsReport } = await import('../amazon/report-import.js');
  const { orgId, account } = await oneAccount(flags);
  const text = await readFile(file, 'utf8');
  const result = await importAmazonEarningsReport({
    orgId,
    account,
    text,
    receivedVia: 'cli',
    log: stderrLog as unknown as Parameters<typeof importAmazonEarningsReport>[0]['log'],
  });
  if (!result.ok) {
    const e = new Error(`${result.code}: ${result.message}`) as Error & { details?: unknown };
    e.details = result.errors;
    throw e;
  }
  return { file, ...result.summary };
}

async function runTemplate(flags: Flags): Promise<unknown> {
  const { propertiesTemplate } = await import('../amazon/links.js');
  const t = await propertiesTemplate({ orgSlug: str(flags, 'org-slug') ?? 'afflino' });
  const leftOut = Object.entries(t.left_out_platforms)
    .map(([p, n]) => `${n} ${p}`)
    .join(', ');
  console.error(
    `amazon: template of ${t.rows} owner-operated Facebook / Instagram / web properties (${t.mapped} with a tracking ID already): keep only the pages listed on the Associates account, one tracking ID each` +
      (leftOut ? `; left out (Amazon links never go there): ${leftOut}` : ''),
  );
  return new RawOutput(t.csv);
}

async function runLinks(flags: Flags): Promise<unknown> {
  const format = str(flags, 'format') ?? 'json';
  if (format !== 'csv' && format !== 'json') throw new UsageError('--format is csv or json');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required (links are minted through POST /v1/links)');
  const slug = str(flags, 'org-slug') ?? 'afflino';
  const { getPool } = await import('../db.js');
  const org = (await getPool().query<{ id: string }>(`select id from organisations where slug = $1`, [slug])).rows[0];
  if (!org) throw new Error(`no organisation '${slug}'`);
  const jwt = (await import('jsonwebtoken')).default;
  // A short-lived token for this process only; it never leaves it.
  const token = jwt.sign({ sub: 'amazon-links-cli', org_id: org.id, role: 'network_admin' }, secret, { expiresIn: '30m' });
  const { buildApp } = await import('../index.js');
  const { redirectLinkUrl } = await import('../redirect-url.js');
  const { mintAmazonLinks, linkSheetCsv } = await import('../amazon/links.js');
  const app = await buildApp({ logStream: { write: () => undefined } });
  await app.ready();
  let result;
  try {
    result = await mintAmazonLinks({
      orgSlug: slug,
      redirectUrl: redirectLinkUrl,
      post: async (body, key) => {
        const r = await app.inject({
          method: 'POST',
          url: '/v1/links',
          headers: { authorization: `Bearer ${token}`, 'idempotency-key': key, 'content-type': 'application/json' },
          payload: body,
        });
        return { statusCode: r.statusCode, headers: r.headers as Record<string, unknown>, body: r.body };
      },
    });
  } finally {
    await app.close();
  }
  const skipped = result.placements_skipped_store_default.length;
  console.error(
    `amazon: links for ${result.placements} placement(s) with their own tracking ID × ${result.offers} live offer(s): ` +
      `minted ${result.minted}, existing ${result.existing}, failed ${result.failed.length}` +
      (skipped > 0 ? `; skipped ${skipped} placement(s) that carry the store ID (give each a tracking ID first: their sales could not be attributed)` : ''),
  );
  for (const f of result.failed.slice(0, 50)) console.error(`  FAILED ${f.platform}/${f.account} ${f.asin}: HTTP ${f.status} ${f.code}: ${f.message}`);
  const code = result.failed.length > 0 ? 1 : 0;
  if (format === 'csv') return new RawOutput(linkSheetCsv(result.links), code);
  return new RawOutput(`${JSON.stringify(result, null, 2)}\n`, code);
}

async function runKillSwitch(flags: Flags, action: 'pause' | 'resume'): Promise<unknown> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required (the kill switch goes through POST /v1/programmes/:id/' + action + ')');
  const jwt = (await import('jsonwebtoken')).default;
  const { buildApp } = await import('../index.js');
  const { __lastRouteCacheSecondDelete } = await import('../routes/programmes.js');
  const { amazonKillSwitch } = await import('../amazon/links.js');
  const app = await buildApp({ logStream: { write: () => undefined } });
  await app.ready();
  try {
    const out = await amazonKillSwitch({
      orgSlug: str(flags, 'org-slug') ?? 'afflino',
      action,
      sign: (sub, orgId) => jwt.sign({ sub, org_id: orgId, role: 'network_admin' }, secret, { expiresIn: '10m' }),
      post: async (url, bearer) => {
        const r = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${bearer}` } });
        return { statusCode: r.statusCode, headers: r.headers as Record<string, unknown>, body: r.body };
      },
    });
    // The route clears the cached routes again 2 s after its commit: wait for it.
    await __lastRouteCacheSecondDelete();
    return out;
  } finally {
    await app.close();
  }
}

async function runStatus(flags: Flags): Promise<unknown> {
  const { amazonStatus } = await import('../amazon/links.js');
  return amazonStatus({ orgSlug: str(flags, 'org-slug') ?? 'afflino' });
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(argv);
  } catch (err) {
    console.error(`amazon: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  if (!parsed.command || parsed.flags.get('help') === true) {
    console.error(USAGE);
    return parsed.command ? 0 : 2;
  }
  const commands: Record<string, (f: Flags) => Promise<unknown>> = {
    setup: runSetup,
    offers: runOffers,
    'import-report': runImport,
    returns: runReturns,
    'apply-return': runApplyReturn,
    template: runTemplate,
    links: runLinks,
    status: runStatus,
    pause: (f) => runKillSwitch(f, 'pause'),
    resume: (f) => runKillSwitch(f, 'resume'),
  };
  const run = commands[parsed.command];
  if (!run) {
    console.error(`amazon: unknown command '${parsed.command}'\n${USAGE}`);
    return 2;
  }
  try {
    const out = await run(parsed.flags);
    if (out instanceof RawOutput) {
      process.stdout.write(out.text);
      return out.code;
    }
    console.log(JSON.stringify(out, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`amazon: ${err.message}\n${USAGE}`);
      return 2;
    }
    console.error(`amazon: ${(err as Error).message}`);
    const details = (err as { details?: unknown }).details;
    if (Array.isArray(details)) for (const d of details.slice(0, 50)) console.error(`  ${JSON.stringify(d)}`);
    return 1;
  } finally {
    await closeConnections();
  }
}

async function closeConnections(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { redis } = await import('../redis.js');
    const r = redis();
    if (r) r.disconnect();
    const { pool } = await import('../db.js');
    await pool.end();
  } catch {
    // closing is best-effort; the process exits next
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
