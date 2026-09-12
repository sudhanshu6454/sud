// Walk the System User's Pages, resolve connected Instagram accounts, write config/assets.json. Never hand-type 100 IDs.
import fs from 'node:fs';
import { loadEnv } from '../lib/env.js';
import { getJSON } from '../lib/http.js';
loadEnv();
const G = 'https://graph.facebook.com/v21.0'; const tok = process.env.META_SYSTEM_USER_TOKEN;
if (!tok) { console.error('META_SYSTEM_USER_TOKEN missing in .env'); process.exit(1); }
const fb = [], ig = []; let url = `${G}/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100&access_token=${tok}`;
while (url) { const j = await getJSON(url); for (const p of j.data || []) { fb.push({ page_id: p.id, name: p.name, has_ig: !!p.instagram_business_account }); if (p.instagram_business_account) ig.push({ ig_user_id: p.instagram_business_account.id, username: p.instagram_business_account.username, page_id: p.id, page_name: p.name }); } url = j.paging?.next; }
fs.writeFileSync('config/assets.json', JSON.stringify({ generated_at: new Date().toISOString(), ig, fb }, null, 2));
console.log(`Pages: ${fb.length} · Instagram accounts: ${ig.length}`);
const noIg = fb.filter(p => !p.has_ig); if (noIg.length) console.log('Pages without a connected Instagram account:\n  ' + noIg.map(p => p.name).join('\n  '));
