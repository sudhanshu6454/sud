import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../lib/http.js';

const TOKEN = 'EAADsc8ZBhMbIBSo0LySs3aUjf2ZCFQVBnkZCztcZC4tORZBokW0Llnf';

test('an access token in a failing URL never reaches the error text', () => {
  const out = redact(`HTTP 403 https://graph.facebook.com/v21.0/178414?fields=x&access_token=${TOKEN} {"error":{}}`);
  assert.ok(!out.includes(TOKEN), 'token leaked into the error message');
  assert.match(out, /access_token=<redacted>/);
  assert.match(out, /graph\.facebook\.com/, 'the useful part of the URL is still there');
});

test('the response body is scrubbed too, since Meta echoes the token back', () => {
  const out = redact(`HTTP 400 https://x/y {"error":{"message":"Malformed access_token=${TOKEN}"}}`);
  assert.ok(!out.includes(TOKEN));
});

test('every credential query key this worker uses is covered', () => {
  for (const k of ['access_token', 'api_key', 'apikey', 'key', 'client_secret', 'token']) {
    assert.ok(!redact(`https://x/y?${k}=SEKRIT123&z=1`).includes('SEKRIT123'), k);
  }
});

test('a token stops at the next parameter rather than eating the rest of the URL', () => {
  assert.equal(redact('https://x/y?access_token=abc123&fields=name'), 'https://x/y?access_token=<redacted>&fields=name');
});

test('a URL with no credential is left alone', () => {
  const clean = 'HTTP 404 https://en.wikipedia.org/api/rest_v1/metrics/Haiwaan not found';
  assert.equal(redact(clean), clean);
});
