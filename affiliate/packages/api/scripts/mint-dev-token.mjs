#!/usr/bin/env node
/**
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * LOCAL DEVELOPMENT ONLY — NEVER use in staging/production.
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * Mints a JWT for local API testing. The token carries { sub, org_id, role }
 * claims signed with JWT_SECRET and is trusted verbatim by the API's
 * requireAuth middleware (which does not yet consult the memberships table).
 *
 * Usage:
 *   JWT_SECRET=dev-secret node scripts/mint-dev-token.mjs \
 *     --sub user-123 --org-id org-abc --role network_admin [--ttl 1h]
 *
 * Then: curl -H "Authorization: Bearer <token>" http://localhost:3000/v1/looks
 */
import jwt from 'jsonwebtoken';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

const sub = flag('sub', 'dev-user');
const org_id = flag('org-id', 'dev-org');
const role = flag('role', 'network_admin');
const ttl = flag('ttl', '8h');

const token = jwt.sign({ sub, org_id, role }, secret, { expiresIn: ttl });
console.log(token);
