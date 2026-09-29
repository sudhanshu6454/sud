/**
 * TRUST_PROXY → Fastify's `trustProxy` option, shared by the api and the
 * redirect (both read `process.env.TRUST_PROXY` and pass the result to
 * `Fastify({ trustProxy })`).
 *
 * Which peers may set X-Forwarded-For decides what `req.ip` is, and the
 * redirect stores a hash of `req.ip` for every click (HMAC-SHA256 with
 * IP_HASH_KEY, or a plain SHA-256 without one), so this is the setting that
 * decides whether a shopper can choose their own hash:
 *
 *   unset / empty / "false"   → `false`: trust nothing; `req.ip` is the TCP
 *                               peer and X-Forwarded-For is ignored (Fastify's
 *                               default, and the behaviour before this setting
 *                               existed).
 *   "true"                    → trust every hop. Only safe when nothing but the
 *                               edge proxy can reach the service.
 *   a non-negative integer    → hop count (1 = the address the nearest proxy
 *                               wrote into X-Forwarded-For).
 *   a comma list              → addresses, CIDR ranges (10.0.0.0/8, fd00::/8,
 *                               10.0.0.0/255.0.0.0) or proxy-addr names
 *                               (`loopback`, `linklocal`, `uniquelocal`). A
 *                               request from a listed peer resolves to the
 *                               nearest untrusted address in X-Forwarded-For.
 *
 * docker-compose.prod.yml sets `loopback,uniquelocal`: the edge (Caddy) and
 * the web's /api proxy reach the services over the compose network's private
 * range, and Caddy overwrites any client-supplied X-Forwarded-For with the
 * address it saw (docker/Caddyfile).
 *
 * The list is checked for shape here so a typo fails at boot with a clear
 * message; Fastify (proxy-addr) does the definitive parse and throws on an
 * address that only looks right (e.g. 999.1.1.1).
 */
export type TrustProxySetting = boolean | number | string[];

const NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f]*:[0-9a-f:.]*$/i;
const PREFIX = /^(\d{1,3}|\d{1,3}(\.\d{1,3}){3})$/;

function validEntry(entry: string): boolean {
  if (NAMES.has(entry)) return true;
  const [address = '', prefix, extra] = entry.split('/');
  if (extra !== undefined) return false;
  if (prefix !== undefined && !PREFIX.test(prefix)) return false;
  return IPV4.test(address) || IPV6.test(address);
}

export function parseTrustProxy(raw: string | undefined | null): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '') return false;
  const lower = value.toLowerCase();
  if (lower === 'false') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);

  const entries = value
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
    .map((e) => (NAMES.has(e.toLowerCase()) ? e.toLowerCase() : e));
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (!validEntry(entry)) {
      throw new Error(
        `TRUST_PROXY: '${entry}' is not an IP address, a CIDR range or one of loopback, linklocal, uniquelocal ` +
          `(accepted: true, false, a hop count, or a comma list of those)`,
      );
    }
  }
  return entries;
}
