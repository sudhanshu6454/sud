// Minimal .env loader (no dependency). Values already in process.env win.
import fs from 'node:fs';
export function loadEnv(path = '.env') {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
export const env = (k, d = '') => (process.env[k] ?? d);
