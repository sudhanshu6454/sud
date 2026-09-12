#!/usr/bin/env node
// Verify every Instagram handle in config/sources.json before you rely on it.
//
// The registry's handles were compiled from public knowledge, not confirmed account by account —
// Instagram disallows crawling, so there was no legitimate way to check them in bulk. Business
// Discovery is the legitimate way: it answers only for public professional accounts, from an
// account you own. This script asks it about each handle once and writes back what it found.
//
// Handles that fail are not deleted — they are marked enabled:false with the reason, so the list
// stays auditable and you can fix a typo rather than lose the entry.
import fs from 'node:fs';
import { loadEnv } from '../lib/env.js';
import { discover } from '../connectors/meta-discovery.js';

loadEnv();
const P = 'config/sources.json';
if (!fs.existsSync(P)) { console.error('config/sources.json not found — copy config/sources.example.json first.'); process.exit(2); }
if (!process.env.META_SYSTEM_USER_TOKEN) { console.error('META_SYSTEM_USER_TOKEN not set.'); process.exit(2); }

const cfg = JSON.parse(fs.readFileSync(P, 'utf8'));
const self = process.env.IG_SELF_USER_ID || cfg.self_ig_user_id;
if (!self) { console.error('Set self_ig_user_id in config/sources.json (any ig_user_id from config/assets.json) or IG_SELF_USER_ID in .env.'); process.exit(2); }

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
let ok = 0, bad = 0, skipped = 0;
for (const a of cfg.instagram) {
  if (only.length && !only.includes(a.username)) { skipped++; continue; }
  try {
    const r = await discover(self, a.username);
    if (!r) throw new Error('no business_discovery in response (not a public professional account?)');
    a.enabled = true;
    a.followers = r.followers;
    a.media_count = r.media_count;
    a.checked_at = new Date().toISOString().slice(0, 10);
    delete a.error;
    ok++;
    console.log(`ok   @${a.username.padEnd(28)} ${r.followers.toLocaleString('en-IN').padStart(12)} followers · ${r.media_count.toLocaleString('en-IN')} posts`);
  } catch (e) {
    a.enabled = false;
    a.error = e.message.slice(0, 180);
    a.checked_at = new Date().toISOString().slice(0, 10);
    bad++;
    console.log(`FAIL @${a.username.padEnd(28)} ${e.message.slice(0, 120)}`);
  }
}
fs.writeFileSync(P, JSON.stringify(cfg, null, 1));
console.log(`\n${ok} verified · ${bad} disabled with a reason · ${skipped} skipped. Written back to ${P}.`);
if (bad) console.log('A FAIL usually means the handle changed, the account is personal rather than professional, or the app lacks instagram_basic on that asset. Fix the handle and re-run for just that one: node scripts/discovery-check.js <username>');
