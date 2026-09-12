// Fuzzy film matching for captions, trending titles and Search Console queries.
export const norm = t => String(t || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim();
export function filmTerms(film) {
  return [film.title, ...(film.aliases || []), ...(film.hashtags || []).map(h => '#' + h)].map(norm).filter(t => t.length > 2);
}
export function textMatchesFilm(text, film) {
  const t = norm(text); if (!t) return false;
  return filmTerms(film).some(term => t.includes(term.replace(/^#/, '')));
}
export function trendingMatchesFilm(title, film) {
  const t = norm(title);
  return filmTerms(film).some(term => t === term.replace(/^#/, '') || t.includes(term.replace(/^#/, ''))) ||
    (film.cast || []).some(c => t.includes(norm(c)));
}
