// KOBIS (Korean Film Council) → the only public daily box office in the world that also
// publishes a reservation rate, i.e. the share of tomorrow's tickets already sold.
//
// This is not an Indian signal and Pulse does not use it to forecast an Indian film. It exists
// because every advance-booking leg in Pulse rests on an assumption no Indian source will ever
// let you check — what fraction of Day 1 is pre-booked, and how a pre-release booking share maps
// to an actual opening. Korea prints both, audited, every morning. Running this connector on a
// handful of Korean releases gives the model a ground truth to calibrate that leg against, and a
// standing check that the method is not drifting.
//
// Free key from kobis.or.kr (KOFIC open API). Public data.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';

export const name = 'kobis';
export const fields = [];                 // calibration only — writes no Pulse signal
export const enabled = () => !!process.env.KOBIS_KEY;

const API = 'https://www.kobis.or.kr/kobisopenapi/webservice/rest';
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

/** Daily box office for one day (default: yesterday, Korea time). */
export async function daily(date, opts = {}) {
  const d = date || ymd(new Date(Date.now() + 9 * 36e5 - 864e5));
  const j = await getJSON(`${API}/boxoffice/searchDailyBoxOfficeList.json?key=${process.env.KOBIS_KEY}&targetDt=${d}`,
    { perMinute: 60, fetchImpl: opts.fetchImpl });
  const list = j.boxOfficeResult?.dailyBoxOfficeList || [];
  return {
    date: d,
    films: list.map(x => ({
      rank: +x.rank, title: x.movieNm, open: x.openDt,
      admissions: +x.audiCnt || 0, admissions_total: +x.audiAcc || 0,
      sales: +x.salesAmt || 0, sales_total: +x.salesAcc || 0,
      screens: +x.scrnCnt || 0, shows: +x.showCnt || 0,
    })),
  };
}

/** What Pulse actually wants: the observed opening-day share of the run so far, per film. */
export function calibration(day) {
  return day.films.map(f => ({
    title: f.title, rank: f.rank, open: f.open,
    admissions: f.admissions, admissions_total: f.admissions_total,
    day1_share: f.admissions_total ? f.admissions / f.admissions_total : null,
    won_per_admission: f.admissions ? Math.round(f.sales / f.admissions) : null,
    per_show: f.shows ? Math.round(f.admissions / f.shows) : null,
  }));
}

export async function run(film_id, film, opts = {}) {
  const day = opts.day || await daily(opts.date, opts);
  const rows = calibration(day);
  const atp = rows.filter(r => r.won_per_admission).map(r => r.won_per_admission);
  const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
  const raw = { date: day.date, films: rows.length, won_per_admission_median: median(atp),
                per_show_median: median(rows.filter(r => r.per_show).map(r => r.per_show)), rows };
  log(name, film_id || 'market', 'kobis', rows.length, raw);
  return { signals: {}, meta: { kobis: { source: 'KOBIS · KOFIC open API (daily box office)', at: new Date().toISOString(), raw } } };
}
