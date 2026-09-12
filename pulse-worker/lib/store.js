// Append-only JSONL log of every raw fetch + a small state file (90-day network max, tr24 freezes, hashtag slots).
import fs from 'node:fs';
import path from 'node:path';
const DATA = process.env.PULSE_DATA_DIR || 'data';
fs.mkdirSync(path.join(DATA, 'out'), { recursive: true });

export function log(connector, film_id, field, value, raw) {
  const row = { at: new Date().toISOString(), connector, film_id, field, value, raw };
  fs.appendFileSync(path.join(DATA, 'ingest-log.jsonl'), JSON.stringify(row) + '\n');
  return row;
}
export function readLog(filter = () => true) {
  const p = path.join(DATA, 'ingest-log.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(filter);
}
const STATE = path.join(DATA, 'state.json');
export function state() { return fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { networkDaily: {}, tr24: {}, hashtagSlots: {} }; }
export function saveState(s) { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); }
export function writePayload(film_id, payload) {
  const p = path.join(DATA, 'out', `film-${film_id}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  return p;
}
