// Mock fetch: route by URL substring → JSON/text body. Records calls for assertions.
export function mockFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    const hit = routes.find(r => url.includes(r.match));
    if (!hit) return new Response('not found', { status: 404 });
    const status = hit.status || 200;
    const body = typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body);
    return new Response(body, { status, headers: { 'content-type': typeof hit.body === 'string' ? 'text/xml' : 'application/json' } });
  };
  f.calls = calls; return f;
}
export const film = { title: 'Haiwaan', aliases: ['haiwaan movie'], cast: ['Akshay Kumar', 'Saif Ali Khan'], wiki_title: 'Haiwaan_(film)', yt_trailer_ids: ['TRAILER1'], yt_song_ids: ['SONG1', 'SONG2'], hashtags: ['haiwaan', 'haiwaantrailer'], hashtag_account: '178400001', trends_benchmark: 'Jawan' };
