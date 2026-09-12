// Intent-to-watch classifier: every audience comment that states what the person will do is a survey response.
// Classes: definite (theatre, opening weekend), conditional (later / after reviews), no (skip / OTT), none (no intent stated).
// Output shape mirrors a poll sample so Pulse can pool it with real polls (source factor for comments is set in the UI).
import { isSpam } from './sentiment.js';
export const MODEL = 'intent-hinglish-v1';

const DEFINITE = ['fdfs', 'first day first show', 'first day', 'day one', 'day 1', 'opening day', 'booking done', 'ticket book', 'tickets booked', 'booked', 'book kar', 'book karunga', 'book karenge', 'advance booking', 'pakka dekhunga', 'pakka dekhenge', 'zaroor dekhunga', 'zaroor dekhenge', 'definitely watching', 'definitely watch', 'will watch', 'watching in theatre', 'watching in theater', 'theatre me dekhunga', 'theatre me dekhenge', 'theater me dekhunga', 'theater me dekhenge', 'theatre mein dekhenge', 'cinema me dekhenge', 'cinema mein dekhenge', 'hall me dekhenge', 'bade parde', 'big screen', "can't wait", 'cant wait', 'cannot wait', 'countdown', 'ticket kab', 'booking kab', 'kab book', 'must watch', 'going first day', 'jaa rahe', 'ja raha hu', 'dekhne ja', 'weekend pe dekhenge', 'weekend plan', 'mass dekhne'];
const CONDITIONAL = ['reviews ke baad', 'review ke baad', 'review dekh', 'reviews dekh', 'after reviews', 'wait for reviews', 'dekhte hain', 'dekhte hai', 'shayad', 'maybe', 'might watch', 'agar', 'if reviews', 'if good', "let's see", 'lets see', 'soch rahe', 'sochenge', 'baad me dekhenge', 'baad mein dekhenge', 'dekh lenge', 'second week', 'kabhi dekh lenge', 'depends', 'not sure'];
const NO = ['ott pe', 'ott par', 'ott me', 'ott mein', 'ott aane', 'wait for ott', 'netflix pe', 'prime pe', 'hotstar pe', 'jio pe', 'nahi dekhunga', 'nahi dekhenge', 'nhi dekhunga', 'nhi dekhenge', 'nahi dekhne', 'not watching', "won't watch", 'wont watch', 'skip', 'skipping', 'boycott', 'pass', 'hard pass', 'no thanks', 'theatre me nahi', 'theater me nahi', 'ticket ke paise', 'paise barbaad', 'paise barbad', 'tv pe dekhenge', 'free me dekhenge', 'download kar', 'torrent', 'telegram pe'];
const OTTISH = ['ott', 'netflix', 'prime', 'hotstar', 'jio', 'tv pe', 'free me', 'download', 'torrent', 'telegram'];
const NEGAFTER = ['nahi', 'nhi', 'nahin', 'na', 'mat'];

const isWord = w => /^[a-z' ]+$/.test(w);
const hit = (t, w) => (isWord(w) ? new RegExp(`(^|[^a-z])${w.replace(/'/g, "'?")}([^a-z]|$)`).test(t) : t.includes(w));
const clean = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function classifyIntent(text) {
  const t = clean(text);
  if (!t || isSpam(t)) return 'none';
  if (NO.some(w => hit(t, w))) return 'no';
  const cond = CONDITIONAL.some(w => hit(t, w));
  const def = DEFINITE.some(w => {
    if (!hit(t, w)) return false;
    // "dekhunga nahi", "book nahi karenge" → negated definite = no
    const idx = t.indexOf(w); const after = t.slice(idx + w.length).split(/[,.!?;]/)[0].split(/\s+/).filter(Boolean).slice(0, 2);
    return !after.some(a => NEGAFTER.includes(a.replace(/[^a-z]/g, '')));
  });
  if (def && !cond) return 'definite';
  if (cond) return 'conditional';
  if (DEFINITE.some(w => hit(t, w))) return 'no'; // definite phrase present but negated
  return 'none';
}
export function isOttish(text) { const t = clean(text); return OTTISH.some(w => hit(t, w)); }

/** comments: [{text, likes?}] → poll-shaped sample. Each expressing comment counts once (weighting by likes would
 *  double-count a crowd's agreement with a single poster; a poll is one voice, one vote). */
export function intentSample(comments) {
  let def = 0, prob = 0, ott = 0, no = 0, none = 0;
  for (const c of comments) {
    const text = typeof c === 'string' ? c : c.text;
    const k = classifyIntent(text);
    if (k === 'definite') def++; else if (k === 'conditional') prob++; else if (k === 'no') { if (isOttish(text)) ott++; else no++; } else none++;
  }
  const n = def + prob + ott + no;
  return { n, def, prob, ott, no, none, expressed_share: comments.length ? Math.round((n / comments.length) * 100) : 0, definite_share: n ? Math.round((def / n) * 100) : null, model: MODEL };
}
