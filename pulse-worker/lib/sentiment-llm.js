// Optional LLM classifier: far better than a lexicon on Hinglish sarcasm and mixed comments. Enabled when
// ANTHROPIC_API_KEY and SENTIMENT_MODEL are set (pick a current small/fast model id; see README). Falls back to the lexicon.
// Batches of 40 comments → JSON array of {i, label} — never sends likes, usernames or ids; only the comment text.
import { analyse as lexicon, aspectsOf, isSpam, relabel } from './sentiment.js';
export const enabled = () => !!process.env.ANTHROPIC_API_KEY && !!process.env.SENTIMENT_MODEL;

async function labelBatch(texts, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  const prompt = `You label audience comments on a Hindi film trailer/teaser as "positive" (excited, praising, intends to watch in theatre), "negative" (dismissive, criticising, boycott/OTT-wait, disappointed) or "neutral" (questions, jokes without polarity, unrelated). Hinglish and Devanagari are common; sarcasm counts by intent. Reply ONLY with a JSON array of {"i":index,"label":...} for every comment.\n\n` + texts.map((t, i) => `${i}: ${t.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  const res = await f('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.SENTIMENT_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
  if (!res.ok) throw new Error(`LLM classifier HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json(); const txt = (j.content || []).map(c => c.text || '').join('');
  const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
  const labels = new Array(texts.length).fill('neutral');
  for (const x of arr) if (Number.isInteger(x.i) && x.i < texts.length && ['positive', 'negative', 'neutral'].includes(x.label)) labels[x.i] = x.label;
  return labels;
}
export async function analyse(comments, { fetchImpl } = {}) {
  if (!enabled()) return lexicon(comments);
  const kept = comments.map(c => (typeof c === 'string' ? { text: c } : c)).filter(c => !isSpam(c.text));
  const spam = comments.length - kept.length;
  let labels = [];
  try { for (let i = 0; i < kept.length; i += 40) labels.push(...await labelBatch(kept.slice(i, i + 40).map(c => c.text), fetchImpl)); }
  catch (e) { console.warn(`[sentiment-llm] ${e.message} — falling back to lexicon`); return lexicon(comments); }
  let pos = 0, neg = 0, neutral = 0, wp = 0, wn = 0; const love = {}, worry = {};
  kept.forEach((c, i) => { const w = 1 + Math.log10(1 + (+c.likes || 0)); const l = labels[i];
    if (l === 'positive') { pos++; wp += w; for (const a of aspectsOf(c.text)) { const k = relabel(a, 'positive'); love[k] = (love[k] || 0) + w; } }
    else if (l === 'negative') { neg++; wn += w; for (const a of aspectsOf(c.text)) { const k = relabel(a, 'negative'); worry[k] = (worry[k] || 0) + w; } } else neutral++; });
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, w]) => ({ label, weight: Math.round(w * 10) / 10 }));
  return { n: comments.length, scored: kept.length, pos, neg, neutral, spam, pct: wp + wn ? Math.round((wp / (wp + wn)) * 100) : null, pct_unweighted: pos + neg ? Math.round((pos / (pos + neg)) * 100) : null, love: top(love), worry: top(worry), model: `llm:${process.env.SENTIMENT_MODEL}` };
}
