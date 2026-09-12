// Audience-comment sentiment for Hindi film content. v2: word-boundary lexicon, Hinglish negation, spam filter,
// like-weighting, aspect themes ("what they love / what worries them"). Optional LLM classifier in ./sentiment-llm.js.
// Version is stamped into meta.sentiment.raw.model — bump it when you change the lexicon and re-score from the log.
export const MODEL = 'lexicon-hinglish-v2';

const POS = ['mast', 'faadu', 'fadu', 'zabardast', 'zabardast', 'kamaal', 'kamal', 'paisa vasool', 'blockbuster', 'goosebumps', 'bawaal', 'bawal', 'dhamaka', 'op', 'fire', 'lit', 'awesome', 'amazing', 'excited', 'cant wait', "can't wait", 'first day first show', 'fdfs', 'superb', 'best', 'love', 'loved', 'wow', 'killer', 'jhakaas', 'jhakkas', 'chha gaye', 'chhaa gaye', 'aag laga di', 'aag lga di', 'booking done', 'ticket book', 'book kar', 'mass', 'peak', 'legend', 'comeback', 'wapas aa gaya', 'wapsi', 'dhamakedaar', 'sahi hai', 'badhiya', 'badiya', 'achha', 'accha', 'acha', 'achhi', 'acchi', 'achi', 'achhe', 'acche', 'good', 'great', 'perfect', 'outstanding', 'brilliant', 'excellent', 'khatarnak', 'gadar', 'tabahi', 'rocked', 'theatre me dekhenge', 'theater me dekhenge', 'theatre mein dekhenge', 'must watch', 'sure shot hit', 'hit hai', '🔥', '❤', '😍', '👏', '💯', '🙌', '🥵', '🫡'];
const NEG = ['bakwaas', 'bakwas', 'flop', 'boring', 'bekaar', 'bekar', 'ghatiya', 'copy', 'copied', 'remake', 'overacting', 'over acting', 'cringe', 'waste', 'disaster', 'nepo', 'nepotism', 'boycott', 'skip', 'ott pe dekhenge', 'ott par dekhenge', 'ott pe dekh', 'wait for ott', 'ott aane do', 'nahi dekhunga', 'nahi dekhenge', 'nhi dekhunga', 'worst', 'trash', 'bad', 'thumbs down', 'paisa barbaad', 'paise barbad', 'time waste', 'vfx kharab', 'vfx bad', 'poor vfx', 'cheap vfx', 'south copy', 'same story', 'purani', 'ghisa pita', 'wahi purana', 'disappointed', 'disappoint', 'underwhelming', 'meh', 'chhichhora', 'itna hype kyu', 'overhyped', '👎', '🤮', '😴', '🥱', '💩'];
const NEGATORS = ['nahi', 'nhi', 'nahin', 'na', 'not', "don't", 'dont', 'never', 'no', 'mat', 'bilkul nahi'];
const SPAM = [/who'?s? (is )?(watching|here) in/i, /^first!?$/i, /subscribe/i, /^\W*$/, /like (if|agar)/i, /views? (kam|jyada|zyada)/i, /^\d+\s*(views?|likes?)/i, /1 like\s*=/i, /^(nice|good|ok)\W*$/i, /http[s]?:\/\//i];

// Aspects the trade cares about; each maps a set of tokens to a display label.
export const ASPECTS = {
  'Lead star': ['akshay', 'saif', 'shah rukh', 'srk', 'salman', 'ranbir', 'ajay', 'ayushmann', 'rajkummar', 'kareena', 'deepika', 'alia', 'hero', 'heroine', 'bhai', 'king khan', 'actor', 'acting', 'performance', 'screen presence', 'swag'],
  'Action': ['action', 'fight', 'stunt', 'stunts', 'maar', 'dhishoom', 'chase', 'mass scene'],
  'Music / BGM': ['bgm', 'music', 'song', 'songs', 'gaana', 'gana', 'background score', 'theme', 'beat'],
  'Dialogues': ['dialogue', 'dialogues', 'dialog', 'line', 'lines', 'punch'],
  'Story / writing': ['story', 'kahani', 'plot', 'script', 'writing', 'twist', 'suspense', 'climax', 'ending'],
  'VFX / scale': ['vfx', 'cgi', 'graphics', 'visuals', 'scale', 'grand', 'budget', 'cinematography', 'camera'],
  'Comedy': ['comedy', 'funny', 'hasi', 'humour', 'humor', 'laugh', 'jokes'],
  'Nostalgia / franchise': ['nostalgia', 'nostalgic', 'sequel', 'part 1', 'part 2', 'franchise', 'original', 'old', 'purana', 'childhood', '90s', '2000s'],
  'Remake / originality': ['remake', 'copy', 'copied', 'south', 'tamil', 'telugu', 'korean', 'hollywood', 'inspired', 'same'],
  'Hype / trailer cut': ['trailer', 'teaser', 'cut', 'edit', 'editing', 'hype', 'goosebumps', 'promo'],
  'Runtime / pace': ['long', 'lengthy', 'slow', 'boring', 'pace', 'drag', 'runtime'],
  'OTT vs theatre': ['ott', 'netflix', 'prime', 'theatre', 'theater', 'cinema', 'hall', 'ticket', 'booking', 'fdfs'],
};

const isWord = w => /^[a-z' ]+$/.test(w);
const hit = (t, w) => (isWord(w) ? new RegExp(`(^|[^a-z])${w.replace(/'/g, "'?")}([^a-z]|$)`).test(t) : t.includes(w));
const clean = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function isSpam(text) { const t = clean(text); return t.length < 2 || SPAM.some(r => r.test(t)); }

// Negation flips a polarity word when a negator sits within 2 tokens before it ("acting nahi achhi", "not bad").
function polarityWithNegation(t, words) {
  let n = 0;
  for (const w of words) {
    if (!hit(t, w)) continue;
    const idx = t.indexOf(w);
    // negation window: up to 2 tokens before the word, but never across a clause boundary (, . ! ? ; / aur / but / lekin / par)
    const clause = t.slice(0, idx).split(/[,.!?;]|\b(?:aur|but|lekin|par|magar)\b/).pop() || '';
    const before = clause.split(/\s+/).filter(Boolean).slice(-2);
    const negated = before.some(b => NEGATORS.includes(b.replace(/[^a-z']/g, '')));
    // post-negation for Hindi word order: "achhi nahi" / "mast nahi hai"
    const after = t.slice(idx + w.length).split(/[,.!?;]/)[0].split(/\s+/).filter(Boolean).slice(0, 2);
    const negatedAfter = after.some(b => ['nahi', 'nhi', 'nahin', 'na'].includes(b.replace(/[^a-z]/g, '')));
    n += negated || negatedAfter ? -1 : 1;
  }
  return n;
}
export function classify(text) {
  const t = clean(text);
  const p = polarityWithNegation(t, POS), n = polarityWithNegation(t, NEG);
  const score = p - n; // a negated positive counts against; a negated negative counts for
  if (score === 0) return 'neutral';
  return score > 0 ? 'positive' : 'negative';
}
// Some aspects read differently by polarity: a positive "OTT vs theatre" comment is theatre intent, a negative one is an OTT wait.
const RELABEL = { 'OTT vs theatre': { positive: 'Will watch in theatre', negative: 'Will wait for OTT' }, 'Remake / originality': { positive: 'Adaptation welcomed', negative: 'Remake / copy concern' }, 'Hype / trailer cut': { positive: 'Trailer cut lands', negative: 'Trailer underwhelms' } };
export const relabel = (a, pol) => RELABEL[a]?.[pol] || a;
export function aspectsOf(text) {
  const t = clean(text); const out = [];
  for (const [label, toks] of Object.entries(ASPECTS)) if (toks.some(k => hit(t, k))) out.push(label);
  return out;
}
/**
 * comments: [{text, likes?}] — likes weight a comment by 1 + log10(1 + likes): an upvoted comment is many people's opinion.
 * Returns pct = weighted positive / (positive + negative), with counts, spam dropped, and aspect themes split by polarity.
 */
export function analyse(comments) {
  let pos = 0, neg = 0, neutral = 0, spam = 0, wp = 0, wn = 0;
  const love = {}, worry = {};
  for (const c of comments) {
    const text = typeof c === 'string' ? c : c.text;
    if (isSpam(text)) { spam++; continue; }
    const w = 1 + Math.log10(1 + (typeof c === 'object' && c.likes ? +c.likes : 0));
    const cls = classify(text);
    if (cls === 'positive') { pos++; wp += w; for (const a of aspectsOf(text)) love[relabel(a, 'positive')] = (love[relabel(a, 'positive')] || 0) + w; }
    else if (cls === 'negative') { neg++; wn += w; for (const a of aspectsOf(text)) worry[relabel(a, 'negative')] = (worry[relabel(a, 'negative')] || 0) + w; }
    else neutral++;
  }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, w]) => ({ label, weight: Math.round(w * 10) / 10 }));
  return { n: comments.length, scored: pos + neg + neutral, pos, neg, neutral, spam, pct: wp + wn ? Math.round((wp / (wp + wn)) * 100) : null, pct_unweighted: pos + neg ? Math.round((pos / (pos + neg)) * 100) : null, love: top(love), worry: top(worry), model: MODEL };
}
// Back-compat with v1 callers.
export function sentimentPct(texts) { const a = analyse(texts.map(t => ({ text: t }))); return { pos: a.pos, neg: a.neg, neutral: a.neutral, pct: a.pct, model: a.model }; }
// Merge per-source analyses into one film-level sentiment, weighting by scored comment volume.
export function merge(sources) {
  let wp = 0, wn = 0, n = 0; const love = {}, worry = {}; const by = {};
  for (const [name, a] of Object.entries(sources)) {
    if (!a || a.pct == null) continue;
    const vol = a.pos + a.neg; n += a.scored; wp += a.pct * vol; wn += (100 - a.pct) * vol;
    for (const x of a.love) love[x.label] = (love[x.label] || 0) + x.weight; for (const x of a.worry) worry[x.label] = (worry[x.label] || 0) + x.weight;
    by[name] = { n: a.n, scored: a.scored, pos: a.pos, neg: a.neg, spam: a.spam, pct: a.pct };
  }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, weight]) => ({ label, weight: Math.round(weight * 10) / 10 }));
  return { pct: wp + wn ? Math.round((wp / (wp + wn)) * 100) : null, n, love: top(love), worry: top(worry), by, model: MODEL };
}
