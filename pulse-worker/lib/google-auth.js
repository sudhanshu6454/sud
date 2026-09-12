// Service-account OAuth2 (JWT bearer) with node:crypto — no googleapis dependency.
import fs from 'node:fs';
import crypto from 'node:crypto';
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
let cache = { token: null, exp: 0 };
export async function googleAccessToken(scope, { keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON, fetchImpl } = {}) {
  if (cache.token && Date.now() < cache.exp - 60e3) return cache.token;
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url');
  const f = fetchImpl || globalThis.fetch;
  const res = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}` });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  cache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cache.token;
}
