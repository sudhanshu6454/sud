/**
 * Screenstat Pulse — admin app. The reference UI's script (v1.0, 7 Sep 2026) with its model and
 * schema imported from pulse-model.js (unchanged) and localStorage replaced by the REST storage
 * adapter below (HANDOVER.md §6). Rendering, formulas and labels are the reference's.
 */
import { compute, poolSamples, wilson, daysUntil, GROUPS, RELEASE, CAL, SOURCES, OPTS, clamp } from './pulse-model.js';

const CFG = window.SSPULSE || {};
const $ = s => document.querySelector(s);

/* ---------- Storage adapter: REST, optimistic local copy, explicit save state ---------- */
let state = { films: [], calendar: [], active: null };
const film = () => state.films.find(f => f.id === state.active);
const isoDate = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayMs = iso => new Date(iso + 'T00:00:00').getTime();
const sampleFromApi = x => ({ id: x.id, src: x.src, t: dayMs(x.taken_on), n: x.n, def: x.def_ct, prob: x.prob_ct, ott: x.ott_ct, no: x.no_ct });
const fromApi = f => ({
  id: f.id, title: f.title, tag: f.tag || '', slug: f.slug, example: !!f.is_example, unfilled: !!f.unfilled, calKey: f.calendar_title || null, calId: f.calendar_id || null,
  s: { ...f.signals }, actual: f.actual || {}, locked: f.locked || null, status: f.status,
  samples: (f.samples || []).map(sampleFromApi),
  hist: (f.readings || []).map(r => ({ t: dayMs(r.read_on), buzz: +r.buzz, intent: +r.intent, life: +r.life_p50, source: r.source })),
});
const ACTIVE_KEY = 'sspulse-active-film';   // a UI preference only: which tab was open. Data never goes to localStorage.
function remember() { try { localStorage.setItem(ACTIVE_KEY, String(state.active)); } catch (e) { /* preference only */ } }

const saveEl = () => $('#saveState');
let pending = 0, failed = null;
function setSaveState(kind, text) {
  const el = saveEl(); if (!el) return;
  el.textContent = text; el.className = 'save-state' + (kind === 'err' ? ' err' : '');
  el.title = kind === 'err' ? 'Click to retry' : '';
}
async function api(method, path, body) {
  pending++; setSaveState('busy', 'Saving…');
  try {
    const res = await fetch(CFG.restUrl + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': CFG.nonce }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) { let msg = res.status + ''; try { msg = (await res.json()).message || msg; } catch (e) { /* no body */ } throw new Error(msg); }
    pending--; failed = null;
    if (!pending) setSaveState('ok', 'Saved · ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST');
    return res.status === 204 ? null : res.json();
  } catch (e) {
    pending--; failed = { method, path, body };
    setSaveState('err', 'Not saved — retry (' + e.message + ')');
    throw e;
  }
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#saveState.err')) { flushDirty(true); if (failed) { const f = failed; failed = null; api(f.method, f.path, f.body).then(() => renderAll()).catch(() => {}); } } });

/* dirty tracking: PATCH carries only the keys that changed (never a full overwrite of `signals`) */
const dirtyMap = new Map();   // filmId -> {title?, tag?, signals:{k:v}}
let flushTimer = null;
function dirty(f, field, key) {
  const d = dirtyMap.get(f.id) || { signals: {} };
  if (field === 'signals') d.signals[key] = f.s[key]; else d[field] = f[field];
  dirtyMap.set(f.id, d);
}
function save() { clearTimeout(flushTimer); flushTimer = setTimeout(() => flushDirty(false), 400); }
function flushDirty(force) {
  for (const [id, d] of dirtyMap) {
    const body = {}; if ('title' in d) body.title = d.title; if ('tag' in d) body.tag = d.tag; if (Object.keys(d.signals).length) body.signals = d.signals;
    dirtyMap.delete(id);
    if (!Object.keys(body).length) continue;
    api('PATCH', '/films/' + id, body).then(f => { const local = state.films.find(x => x.id === f.id); if (local) { local.slug = f.slug; local.unfilled = !!f.unfilled; } }).catch(() => { const back = dirtyMap.get(id) || { signals: {} }; Object.assign(back, body, { signals: { ...(body.signals || {}), ...back.signals } }); dirtyMap.set(id, back); });
  }
}
window.addEventListener('beforeunload', () => { if (dirtyMap.size) flushDirty(true); });

async function load() {
  const [films, calendar] = await Promise.all([api('GET', '/films'), api('GET', '/calendar')]);
  state.films = films.map(fromApi);
  state.calendar = calendar.map(c => ({ id: c.id, t: c.title, d: c.release_date, cast: c.cast_line, dir: c.director, prod: c.banner, source: c.source, confidence: c.confidence }));
  let want = null; try { want = +localStorage.getItem(ACTIVE_KEY); } catch (e) { /* preference only */ }
  state.active = state.films.find(f => f.id === want) ? want : (state.films[0]?.id ?? null);
  if (!state.films.length) {   // empty desk: start with one blank film so the readouts have something to show
    const f = await api('POST', '/films', { title: '', signals: { tr24: 5, trTotal: 15, likeRatio: 35, search: 35, posts: 20, sentiment: 62, bms: 80, song: 20, star: 40, screens: 1500, shows: 4, seats: 190, atp: 180, budget: 50, days: 30, holiday: '0', comp: 'none', kInt: 3.8, bias: 0.25 } });
    state.films.push(fromApi(f)); state.active = f.id;
  }
  setSaveState('ok', 'Loaded · ' + state.films.length + ' film' + (state.films.length === 1 ? '' : 's'));
}

const fmtCr=v=>'₹'+(+v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})+' cr';
const fmtCrN=v=>(+v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtPeople=v=>v>=1e7?(v/1e7).toFixed(2)+' cr':v>=1e5?(v/1e5).toFixed(1)+' lakh':Math.round(v).toLocaleString('en-IN');
const fmtLakh=v=>(v/1e5).toFixed(1);

/* ---------- Signal desk rendering ---------- */
function field(f,val){
  const isSel=f.options;
  if(f.type==='date')return `<div class="sig" data-k="${f.k}"><label for="in-${f.k}">${f.label}<small>overrides days to release</small></label><input type="date" id="in-${f.k}" data-k="${f.k}" value="${val||''}"></div>`;
  return `<div class="sig" data-k="${f.k}">
    <label for="in-${f.k}">${f.label}${f.unit?`<small>${f.unit}</small>`:''}</label>
    ${isSel?`<select id="in-${f.k}" data-k="${f.k}">${f.options.map(o=>`<option value="${o[0]}"${String(val)===o[0]?' selected':''}>${o[1]}</option>`).join('')}</select>`
      :`<input type="number" id="in-${f.k}" data-k="${f.k}" value="${val}" min="${f.min}" max="${f.max}" step="${f.step}">
        <input type="range" data-k="${f.k}" aria-label="${f.label} slider" value="${val}" min="${f.min}" max="${f.max}" step="${f.step}">`}
    ${f.norm!==undefined?`<div class="bar"><i style="width:0%"></i></div>`:''}
  </div>`;
}
function renderDesk(){
  const f=film(); const s=f.s;
  $('#fTitle').value=f.title;
  let h='';
  GROUPS.filter(g=>g.fields.length).forEach(g=>{
    h+=`<div class="group"><h3><span>${g.name}</span><span class="w">weight ${g.w}</span></h3>${g.fields.map(x=>field(x,s[x.k])).join('')}</div>`;
  });
  h+=`<div class="group"><h3><span>Release setup</span><span class="w">supply side</span></h3><div class="row2">${RELEASE.map(x=>field(x,s[x.k])).join('')}</div>
      <div class="row2">${field({k:'holiday',label:'Holiday opening',options:[['0','No'],['1','Yes / extended weekend']]},s.holiday)}${field({k:'comp',label:'Competition that week',options:[['none','None'],['moderate','Moderate'],['heavy','Heavy']]},s.comp)}</div></div>`;
  h+=`<div class="group"><h3><span>Calibration</span><span class="w">tune after release</span></h3><div class="row2">${CAL.map(x=>field(x,s[x.k])).join('')}</div></div>`;
  $('#signals').innerHTML=h;
}
$('#signals').addEventListener('input',e=>{
  const k=e.target.dataset.k; if(!k)return;
  const f=film(); f.s[k]=e.target.value; if(k!=='release'&&k!=='days')f.unfilled=false; dirty(f,'signals',k);
  if(k==='release'&&e.target.value){f.s.days=Math.max(0,daysUntil(e.target.value));dirty(f,'signals','days');const d=document.querySelector('#signals input[data-k="days"]');if(d)document.querySelectorAll('#signals [data-k="days"]').forEach(el=>{if(el.tagName==='INPUT')el.value=f.s.days;});}
  if(k==='days'){f.s.release='';dirty(f,'signals','release');}
  document.querySelectorAll(`#signals [data-k="${k}"]`).forEach(el=>{if(el!==e.target&&el.tagName==='INPUT')el.value=e.target.value;});
  save(); renderReadouts();
});
$('#fTitle').addEventListener('input',e=>{film().title=e.target.value;dirty(film(),'title');save();renderTabs();});

/* ---------- Tabs ---------- */
function renderTabs(){
  const el=$('#filmTabs');
  el.innerHTML=state.films.map(f=>{const r=compute(f.s,f.samples);return `<button class="tab" role="tab" data-id="${f.id}" aria-selected="${f.id===state.active}">
    ${f.example?'<span class="ex">example</span>':f.unfilled?'<span class="ex">no signals yet</span>':''}<span class="t">${esc(f.title)||'Untitled'}</span><span class="d">${f.unfilled?'enter signals to project':'Buzz '+Math.round(r.buzz)+' · '+fmtCr(r.life)}${f.s.release&&daysUntil(f.s.release)<0?' · in cinemas, day '+(1-daysUntil(f.s.release)):' · '+f.s.days+' d to release'}</span></button>`;}).join('')
    +`<button class="tab add" id="addFilm">+ Track a film</button>`+(state.films.some(f=>f.example)?'':`<button class="tab add add-ex" id="loadExamples" title="Three fictional films with signals, samples and readings filled in, so a new team member can see a finished state">Load example films</button>`);
}
$('#filmTabs').addEventListener('click',e=>{
  const t=e.target.closest('.tab'); if(!t)return;
  if(t.id==='addFilm'){
    api('POST','/films',{title:'',signals:{tr24:5,trTotal:15,likeRatio:35,search:35,posts:20,sentiment:62,bms:80,song:20,star:40,screens:1500,shows:4,seats:190,atp:180,budget:50,days:30,holiday:'0',comp:'none',kInt:3.8,bias:0.25}})
      .then(f=>{state.films.push(fromApi(f));state.active=f.id;remember();renderAll();$('#fTitle').focus();}).catch(()=>{});
    return;
  }
  if(t.id==='loadExamples'){
    api('POST','/films/examples',{}).then(r=>{state.films=r.films.map(fromApi);state.active=state.films[state.films.length-1]?.id;remember();renderAll();flash('Example films loaded');}).catch(()=>{});
    return;
  }
  state.active=+t.dataset.id; remember(); renderAll();
});
$('#btnDel').addEventListener('click',()=>{
  if(state.films.length<=1){alert('Keep at least one film. Add another before removing this one.');return;}
  const f=film(); if(!confirm('Archive "'+(f.title||'this film')+'"? Its readings are kept and it disappears from the desk and the public figures.'))return;
  api('DELETE','/films/'+f.id).then(()=>{state.films=state.films.filter(x=>x.id!==f.id); state.active=state.films[0].id; remember(); renderAll();}).catch(()=>{});
});
$('#btnSnap').addEventListener('click',()=>{
  const f=film(); const r=compute(f.s,f.samples);
  api('POST','/films/'+f.id+'/readings',{read_on:todayISO(),buzz:r.buzz,intent:Math.round(r.intent),life_p50:r.mc.life[1],life_p10:r.mc.life[0],life_p90:r.mc.life[2],d1_p10:r.mc.d1[0],d1_p50:r.mc.d1[1],d1_p90:r.mc.d1[2],signals:f.s})
    .then(x=>{Object.assign(f,fromApi(x));renderReadouts();flash('Reading recorded for '+(f.title||'this film'));}).catch(()=>{});
});
$('#btnExport').addEventListener('click',()=>{
  const out=state.films.map(f=>({title:f.title,signals:f.s,history:f.hist,result:compute(f.s,f.samples)}));
  navigator.clipboard?.writeText(JSON.stringify(out,null,2)).then(()=>flash('Copied to clipboard'),()=>flash('Copy blocked by browser'));
});
function flash(msg){const el=$('#liveTxt');const old='Recomputes on every input';el.textContent=msg;setTimeout(()=>el.textContent=old,2200);}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- Readouts ---------- */
function renderReadouts(){
  const f=film(); const s=f.s; const r=compute(s,f.samples);
  // signal bars
  r.parts.forEach(p=>{const row=[...document.querySelectorAll('#signals .sig')].find(x=>x.querySelector('label')?.textContent.startsWith(p.label));if(row){const b=row.querySelector('.bar i');if(b)b.style.width=p.n.toFixed(0)+'%';}});
  // Buzz tile
  $('#buzzVal').textContent=Math.round(r.buzz);
  const band=r.buzz<30?'Quiet — mostly unnoticed':r.buzz<45?'Niche — a core audience is watching':r.buzz<60?'Warm — trade is talking':r.buzz<75?'Hot — mainstream anticipation':'Event film — cultural moment';
  $('#buzzBand').textContent=band;
  const top=[...r.parts].sort((a,b)=>b.c-a.c).slice(0,2).map(p=>p.label.toLowerCase());
  $('#buzzDrivers').textContent=f.unfilled?'Signals not entered yet — every figure on this page is a placeholder until you fill the signal desk':'Led by '+top.join(' and ')+(s.release&&daysUntil(s.release)<0?' · in cinemas, day '+(1-daysUntil(s.release)):' · release in '+s.days+' day'+(s.days==1?'':'s'));
  drawGauge(r.buzz);
  const h=(f.hist||[]);
  const mom=$('#buzzMomentum');
  if(h.length>=2){const a=h[h.length-1],b=h[h.length-2];const dd=Math.max(1,(a.t-b.t)/864e5);const per=(a.buzz-b.buzz)/dd;const cur=r.buzz-a.buzz;const v=per;mom.textContent=(v>=0?'▲ +':'▼ −')+Math.abs(v).toFixed(1)+' / day';mom.className='chip '+(v>0.8?'good':v<-0.5?'crit':'neu');}
  else{mom.textContent='needs 2 readings';mom.className='chip neu';}
  // Intent tile
  $('#intentVal').innerHTML=fmtPeople(r.intent)+'<small>people</small>';
  $('#intentDesc').textContent='≈ '+fmtLakh(r.intent)+' lakh opening-weekend tickets · '+(r.intent/Math.max(1,r.uniqueAware)*100).toFixed(1)+'% of ~'+fmtPeople(r.uniqueAware)+' aware';
  $('#intentSub').textContent=(r.intentSample?'Average of signal-based intent ('+(r.intentDemand/1e5).toFixed(1)+' L) and poll-based intent ('+(r.intentSample/1e5).toFixed(1)+' L from '+r.smp.n.toLocaleString('en-IN')+' respondents)':+s.bms>0?'Interested clicks × k ('+(r.bmsIntent/1e5).toFixed(1)+' L) blended 60/40 with reach × interest rate ('+(r.reachIntent/1e5).toFixed(1)+' L)':'Reach-based only — add BookMyShow interested count for a sharper read');
  const ic=$('#intentChip'); const cov=r.intent/Math.max(1,r.cap*3);
  ic.textContent=cov>0.7?'demand outruns weekend seats':cov>0.35?'healthy demand':'seats will outnumber buyers'; ic.className='chip '+(cov>0.7?'good':cov>0.35?'neu':'warn');
  // Collection tile
  $('#lifeVal').innerHTML=fmtCr(r.life).replace(' cr','<small>cr lifetime est.</small>');
  $('#srcTime').textContent=new Date().toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST';
  $('#lifeDesc').textContent='Day 1 '+fmtCr(r.gross[0])+' · weekend '+fmtCr(r.weekend)+' · week 1 '+fmtCr(r.week1)+' · '+Math.round(r.pHit*100)+'% of simulations clear Hit';
  const lo=r.mc.life[0],hi=r.mc.life[2];
  $('#lifeLo').textContent='P10 '+fmtCr(lo); $('#lifeHi').textContent='P90 '+fmtCr(hi);
  const maxR=hi*1.15; const rg=$('#lifeRange'); rg.querySelector('i').style.left=(lo/maxR*100)+'%'; rg.querySelector('i').style.width=((hi-lo)/maxR*100)+'%'; rg.querySelector('b').style.left=(r.life/maxR*100)+'%';
  const vd=$('#verdict'); vd.textContent=r.verdict[0]+' · '+r.ratio.toFixed(1)+'× budget'; vd.className='chip '+r.verdict[1];
  // Triangulation
  const names={Demand:'Booking-intent signals',Supply:'Screens × occupancy',Audience:'Audience polls'};
  $('#xGrid').innerHTML=r.est.map(e=>`<div><div class="k">${e.name} side</div><div class="v">${fmtLakh(e.v)} L</div><div class="d">${names[e.name]} · Day 1 footfalls</div><div class="w">weight ${Math.round(e.wn*100)}% · ±${Math.round(e.sd*100)}%<i style="width:${Math.round(e.wn*100)}%"></i></div></div>`).join('')
    +(r.est.length<3?`<div style="border-style:dashed"><div class="k">Audience side</div><div class="v" style="color:var(--ink-3)">—</div><div class="d">Log a poll sample below to add a third, independent estimate</div></div>`:'');
  $('#xNote').textContent='Combined Day 1: '+fmtLakh(r.d1)+' lakh footfalls (σ ±'+Math.round(r.sdD1*100)+'%). '+(r.gap<0.15?'The estimates agree within 15% — a tight forecast.':r.gap<0.4?'Estimates differ by '+Math.round(r.gap*100)+'%; the band widens to match.':'Estimates diverge by '+Math.round(r.gap*100)+'%. '+(r.d1Demand>r.d1Supply?'Demand exceeds seats — expect house-full boards and a longer run rather than a bigger Day 1.':'Screens outnumber buyers — occupancy will look thin unless buzz climbs before release.'))+' Occupancy assumed '+Math.round(r.occ*100)+'% of '+fmtLakh(r.cap)+' lakh daily seats.';
  drawComposition(r.parts);
  drawDays(r);
  drawFunnel(r);
  drawHistory(f,r);
  drawTable(r);
  drawSamples(f,r);
  drawAccuracy(f,r);
  renderTabs();
}

/* ---------- Drawings ---------- */
function drawGauge(v){
  const svg=$('#gauge'); const cx=56,cy=62,R=48;
  const arc=(a0,a1,stroke,w)=>{const p=a=>[cx+R*Math.cos(a),cy-R*Math.sin(a)];const [x0,y0]=p(a0),[x1,y1]=p(a1);return `<path d="M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;};
  const a=Math.PI-(Math.PI*v/100);
  svg.innerHTML=arc(Math.PI,0.001,'var(--surface-2)',9)+arc(Math.PI,Math.max(a,0.001),'var(--accent)',9)
   +[30,45,60,75].map(t=>{const at=Math.PI-(Math.PI*t/100);return `<line x1="${cx+(R-9)*Math.cos(at)}" y1="${cy-(R-9)*Math.sin(at)}" x2="${cx+(R+9)*Math.cos(at)}" y2="${cy-(R+9)*Math.sin(at)}" stroke="var(--surface)" stroke-width="2"/>`;}).join('');
}
function drawComposition(parts){
  const W=420,rowH=22,L=170,bw=W-L-56;const H=parts.length*rowH+6;
  let h=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution of each signal to the Buzz Index">`;
  parts.forEach((p,i)=>{const y=i*rowH+3;const w=Math.max(2,bw*p.c/25);
    h+=`<text x="${L-8}" y="${y+14}" text-anchor="end">${esc(p.label)}</text><rect x="${L}" y="${y+3}" width="${bw}" height="12" fill="var(--surface-2)" rx="2"/><rect x="${L}" y="${y+3}" width="${w}" height="12" fill="var(--accent)" rx="2" data-tip="${esc(p.label)}: ${p.c.toFixed(1)} of ${p.w} pts (signal at ${Math.round(p.n)}/100)"/><text class="v" x="${L+w+6}" y="${y+14}">${p.c.toFixed(1)}<tspan style="fill:var(--ink-3);font-weight:400">/${p.w}</tspan></text>`;});
  $('#compChart').innerHTML=h+'</svg>';
}
function drawDays(r){
  const names=['Fri','Sat','Sun','Mon','Tue','Wed','Thu'];const W=560,H=230,pl=44,pr=12,pt=14,pb=28;const iw=W-pl-pr,ih=H-pt-pb;
  const hi=r.mc.days.map(d=>d[2]),lo=r.mc.days.map(d=>d[0]);
  const max=Math.max(...hi)*1.08||1; const step=niceStep(max/4);
  const x=i=>pl+i*(iw/7)+iw/14, y=v=>pt+ih-(v/max)*ih; const bw=iw/7*0.46;
  let h=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected collection by day of opening week"><g class="grid">`;
  for(let v=0;v<=max;v+=step){h+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`;}
  h+=`</g><g class="axis"><line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}"/></g>`;
  r.gross.forEach((g,i)=>{h+=`<rect x="${x(i)-bw/2-3}" y="${y(hi[i])}" width="${bw+6}" height="${Math.max(0,y(lo[i])-y(hi[i]))}" fill="var(--accent-tint)" rx="3"/>`;});
  r.gross.forEach((g,i)=>{const yy=y(g);h+=`<rect x="${x(i)-bw/2}" y="${yy}" width="${bw}" height="${y(0)-yy}" fill="var(--accent)" rx="3" data-tip="${names[i]}: ${fmtCr(g)} (${fmtCr(lo[i])} – ${fmtCr(hi[i])}) · ${fmtLakh(r.days[i])} lakh footfalls"/><text class="v" x="${x(i)}" y="${yy-6}" text-anchor="middle">${fmtCrN(g)}</text><text x="${x(i)}" y="${H-8}" text-anchor="middle">${names[i]}</text>`;});
  $('#dayChart').innerHTML=h+'</svg>';
}
function niceStep(raw){const p=Math.pow(10,Math.floor(Math.log10(raw||1)));const m=raw/p;return (m<1.5?1:m<3.5?2.5:m<7.5?5:10)*p;}
function drawFunnel(r){
  const rows=[['Aware','saw the trailer or a post',r.uniqueAware],['Interested','engaged: liked, searched, clicked interested',Math.max(r.intent*1.9,(+film().s.bms||0)*1e3*1.6)],['Intend to buy','opening-weekend ticket intent',r.intent],['Day 1 seats filled','blended footfall estimate',r.d1]];
  const max=rows[0][2]||1;
  $('#funnel').innerHTML=rows.map((x,i)=>`<div class="f-row"><div class="l">${x[0]}<small>${x[1]}</small></div><div class="b"><i style="width:${Math.max(1,x[2]/max*100)}%;opacity:${1-i*0.15}"></i></div><div class="n">${fmtPeople(x[2])}<small>${i?((x[2]/rows[i-1][2])*100).toFixed(1)+'% of prev':'100%'}</small></div></div>`).join('');
}
function drawHistory(f,r){
  const pts=[...(f.hist||[])];const now={t:Date.now(),buzz:r.buzz,live:true};
  const all=[...pts,now];
  $('#histSub').textContent=pts.length+' reading'+(pts.length===1?'':'s')+' · today shown live';
  const W=420,H=170,pl=30,pr=14,pt=12,pb=26,iw=W-pl-pr,ih=H-pt-pb;
  const t0=Math.min(...all.map(p=>p.t)),t1=Math.max(...all.map(p=>p.t))||1;const span=Math.max(t1-t0,864e5);
  const x=t=>pl+((t-t0)/span)*iw,y=v=>pt+ih-(v/100)*ih;
  let h=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Buzz Index over recorded readings"><g class="grid">`;
  [25,50,75,100].forEach(v=>{h+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`;});
  h+=`</g><g class="axis"><line x1="${pl}" x2="${W-pr}" y1="${y(0)}" y2="${y(0)}"/></g>`;
  if(all.length>1){const d=all.map((p,i)=>(i?'L':'M')+x(p.t).toFixed(1)+' '+y(p.buzz).toFixed(1)).join(' ');
    h+=`<path d="${d} L${x(all[all.length-1].t)} ${y(0)} L${x(all[0].t)} ${y(0)}Z" fill="var(--accent)" opacity=".10"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;}
  all.forEach(p=>{const dt=new Date(p.t);const lab=p.live?'now':dt.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
    h+=`<circle cx="${x(p.t)}" cy="${y(p.buzz)}" r="${p.live?5:4}" fill="${p.live?'var(--ss-ink)':'var(--accent)'}" stroke="var(--surface)" stroke-width="2" data-tip="${lab}: Buzz ${Math.round(p.buzz)}"/>`;});
  const labs=all.length>6?[all[0],all[Math.floor(all.length/2)],all[all.length-1]]:all;
  labs.forEach(p=>{h+=`<text x="${x(p.t)}" y="${H-8}" text-anchor="middle">${p.live?'now':new Date(p.t).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</text>`;});
  $('#histChart').innerHTML=h+'</svg>';
}
function drawTable(r){
  const names=['Friday (Day 1)','Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday'];
  const f=v=>fmtCrN(v);
  let h=`<thead><tr><th>Day</th><th class="n">Footfalls (lakh)</th><th class="n">Occupancy</th><th class="n">P10</th><th class="n">Median ₹ cr</th><th class="n">P90</th></tr></thead><tbody>`;
  r.mc.days.forEach((d,i)=>{const ff=d[1]*1e7/r.atp;h+=`<tr><td>${names[i]}</td><td class="n">${fmtLakh(ff)}</td><td class="n">${Math.round(ff/Math.max(1,r.cap)*100)}%</td><td class="n">${f(d[0])}</td><td class="n"><b>${f(d[1])}</b></td><td class="n">${f(d[2])}</td></tr>`;});
  const add=(l,v)=>`<tr><td><b>${l}</b></td><td class="n"></td><td class="n"></td><td class="n">${fmtCrN(v[0])}</td><td class="n"><b>${fmtCrN(v[1])}</b></td><td class="n">${fmtCrN(v[2])}</td></tr>`;
  h+=add('Opening weekend',r.mc.weekend)+add('Week 1',r.mc.week1)+add('Lifetime (×'+r.lifeMult.toFixed(2)+' hold)',r.mc.life)+'</tbody>';
  $('#projTable').innerHTML=h;
}

/* ---------- Audience sampling ---------- */
const OPT_COLORS={def:'var(--accent)',prob:'var(--accent-tint)',ott:'var(--ink-2)',no:'var(--line-strong)'};
$('#smSrc').innerHTML=Object.entries(SOURCES).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join('');
$('#smOpts').innerHTML=OPTS.map(o=>`<label><span><i style="background:${OPT_COLORS[o[0]]}"></i>${o[1]}</span><input type="number" id="sm_${o[0]}" min="0" step="1" placeholder="0"></label>`).join('');
$('#smDate').valueAsDate=new Date();
function updHint(){const n=+$('#smN').value||0;const sum=OPTS.reduce((a,o)=>a+(+$('#sm_'+o[0]).value||0),0);const src=SOURCES[$('#smSrc').value];
  $('#smHint').textContent=(n?('Margin of error at n='+n+': ±'+(100*1.96*Math.sqrt(0.25/n)).toFixed(1)+' pp. '):'About 385 respondents give ±5 pp; 1,070 give ±3 pp. ')+(sum&&n&&sum!==n?'Option counts sum to '+sum+', not '+n+'. ':'')+'Enthusiasm discount for this source: ×'+src[1]+' (relative to slider).';}
['smN','smSrc','sm_def','sm_prob','sm_ott','sm_no'].forEach(id=>$('#'+id).addEventListener('input',updHint));updHint();
$('#smAdd').addEventListener('click',()=>{
  const f=film();const n=+$('#smN').value||0;const o={};OPTS.forEach(x=>o[x[0]]=+$('#sm_'+x[0]).value||0);const sum=Object.values(o).reduce((a,b)=>a+b,0);
  if(!n||!sum){flash('Enter respondents and at least one option count');return;}
  if(sum>n){flash('Option counts exceed respondents');return;}
  const d=$('#smDate').valueAsDate||new Date();
  api('POST','/films/'+f.id+'/samples',{src:$('#smSrc').value,taken_on:isoDate(d),n,def_ct:o.def,prob_ct:o.prob,ott_ct:o.ott,no_ct:o.no})
    .then(sm=>{f.samples=f.samples||[];f.samples.push(sampleFromApi(sm));f.samples.sort((a,b)=>a.t-b.t);
      ['smN','sm_def','sm_prob','sm_ott','sm_no'].forEach(id=>$('#'+id).value='');updHint();renderReadouts();flash('Sample added');}).catch(()=>{});
});
$('#smScript').addEventListener('click',()=>{const t=film().title||'this film';const txt=`Will you watch ${t} in a theatre?\n1. Definitely — opening weekend\n2. Probably — in theatres, but later\n3. I'll wait for OTT\n4. Not interested`;
  navigator.clipboard?.writeText(txt).then(()=>flash('Poll wording copied'),()=>flash('Copy blocked by browser'));});
$('#smpTable').addEventListener('click',e=>{const b=e.target.closest('.del');if(!b)return;const f=film();const sm=f.samples[+b.dataset.i];if(!sm)return;
  api('DELETE','/films/'+f.id+'/samples/'+sm.id).then(()=>{f.samples.splice(+b.dataset.i,1);renderReadouts();}).catch(()=>{});});
function drawSamples(f,r){
  const sm=r.smp;const list=f.samples||[];
  $('#smpSub').textContent=list.length?list.length+' sample'+(list.length===1?'':'s')+' · '+sm.n.toLocaleString('en-IN')+' respondents pooled':'poll real movie-goers, log every sample here';
  if(!sm.n){$('#smpStats').innerHTML=`<div style="grid-column:1/-1;border-style:dashed"><div class="k">No samples yet</div><div class="d" style="margin-top:4px">Run the poll wording on an Instagram story, YouTube community post, X, your site, or ask people in a cinema lobby. Enter the counts here and the model gets a third estimate that does not depend on BookMyShow or trailer views.</div></div>`;$('#smpTable').innerHTML='';return;}
  const pp=v=>(v*100).toFixed(1)+'%';
  $('#smpStats').innerHTML=`<div><div class="k">Definitely · raw</div><div class="v">${pp(sm.p)}</div><div class="d">95% CI ${pp(sm.lo)} – ${pp(sm.hi)} · ±${(sm.moe*100).toFixed(1)} pp</div></div>
    <div><div class="k">Intent rate · adjusted</div><div class="v">${pp(sm.rateAdj)}</div><div class="d">(definitely + 15% of probably) × ${sm.eff.toFixed(2)} enthusiasm discount</div></div>
    <div><div class="k">Implied intent</div><div class="v">${fmtPeople(r.intentSample)}</div><div class="d">${pp(sm.rateAdj)} of ~${fmtPeople(r.uniqueAware)} aware</div></div>
    <div><div class="k">Sample weight</div><div class="v">${Math.round((r.est.find(e=>e.name==='Audience')?.wn||0)*100)}%</div><div class="d">of the Day 1 triangulation</div></div>
    <div class="stack" style="grid-column:1/-1;margin:0"><i style="width:${sm.p*100}%;background:${OPT_COLORS.def}" data-tip="Definitely: ${pp(sm.p)}"></i><i style="width:${sm.pProb*100}%;background:${OPT_COLORS.prob}" data-tip="Probably later: ${pp(sm.pProb)}"></i><i style="width:${sm.pOtt*100}%;background:${OPT_COLORS.ott}" data-tip="Wait for OTT: ${pp(sm.pOtt)}"></i><i style="width:${sm.pNo*100}%;background:${OPT_COLORS.no}" data-tip="Not interested: ${pp(sm.pNo)}"></i></div>
    <div class="stack-leg" style="grid-column:1/-1;padding:0">${OPTS.map(o=>`<span><i style="background:${OPT_COLORS[o[0]]}"></i>${o[1]}</span>`).join('')}</div>`;
  $('#smpTable').innerHTML=`<thead><tr><th>Date</th><th>Source</th><th class="n">n</th><th class="n">Definitely</th><th class="n">Probably</th><th class="n">OTT</th><th class="n">No</th><th class="n">±pp</th><th></th></tr></thead><tbody>`+
    list.map((x,i)=>{const w=wilson(x.def,x.n);return `<tr><td>${new Date(x.t).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</td><td>${SOURCES[x.src]?.[0]||x.src}</td><td class="n">${x.n}</td><td class="n">${(x.def/x.n*100).toFixed(0)}%</td><td class="n">${(x.prob/x.n*100).toFixed(0)}%</td><td class="n">${(x.ott/x.n*100).toFixed(0)}%</td><td class="n">${(x.no/x.n*100).toFixed(0)}%</td><td class="n">${((w[2]-w[0])*50).toFixed(1)}</td><td><button class="del" data-i="${i}" title="Remove sample">✕</button></td></tr>`;}).join('')+'</tbody>';
}

/* ---------- Model accuracy ---------- */
$('#acSave').addEventListener('click',()=>{
  const f=film();const r=compute(f.s,f.samples);
  const a={d1:+$('#acD1').value||0,we:+$('#acWe').value||0,wk:+$('#acWk').value||0,life:+$('#acLife').value||0};
  if(!a.d1&&!a.we&&!a.wk&&!a.life){flash('Enter at least one actual figure');return;}
  api('PUT','/films/'+f.id+'/actuals',{...a,projection:{d1:r.mc.d1[1],we:r.mc.weekend[1],wk:r.mc.week1[1],life:r.mc.life[1],bms:+f.s.bms||0,atp:r.atp,buzz:r.buzz,d1lo:r.mc.d1[0],d1hi:r.mc.d1[2]}})
    .then(x=>{Object.assign(f,fromApi(x));renderReadouts();flash(f.locked&&Math.abs(f.locked.t-Date.now())<60000?'Actuals saved — projection frozen for comparison':'Actuals updated');}).catch(()=>{});
});
function drawAccuracy(f,r){
  const a=f.actual||{};$('#acD1').value=a.d1||'';$('#acWe').value=a.we||'';$('#acWk').value=a.wk||'';$('#acLife').value=a.life||'';
  $('#acLocked').textContent=f.locked?'Projection frozen on '+new Date(f.locked.t).toLocaleDateString('en-IN',{day:'numeric',month:'short'})+' at Buzz '+Math.round(f.locked.buzz):'Saving freezes today\'s projection so the comparison is honest.';
  const rows=state.films.filter(x=>x.locked&&x.actual&&(x.actual.d1||x.actual.we||x.actual.wk||x.actual.life));
  if(!rows.length){$('#accTable').innerHTML='';$('#accNote').textContent='No films with actuals yet. After a tracked film releases, enter its real Day 1 / weekend / week 1 here. Each one tells the model what k (interested → footfalls) and occupancy really were, and the suggestion below updates.';return;}
  const cell=(p,act)=>{if(!act)return '<td class="n">—</td>';const e=(p-act)/act*100;const c=Math.abs(e)<15?'err-good':Math.abs(e)<30?'err-warn':'err-crit';return `<td class="n"><span class="${c}">${e>=0?'▲ +':'▼ −'}${Math.abs(e).toFixed(1)}%</span> <span style="color:var(--ink-3)">(${fmtCrN(p)} vs ${fmtCrN(act)})</span></td>`;};
  let ks=[];
  $('#accTable').innerHTML=`<thead><tr><th>Film</th><th class="n">Day 1</th><th class="n">Weekend</th><th class="n">Week 1</th><th class="n">Lifetime</th><th class="n">Implied k</th><th class="n">In P10–P90?</th></tr></thead><tbody>`+rows.map(x=>{
    const L=x.locked,A=x.actual;let k='—';
    if(A.we&&L.bms){const kk=(A.we*1e7/L.atp)/(L.bms*1e3);ks.push(kk);k=kk.toFixed(1);}
    const inBand=A.d1?(A.d1>=L.d1lo&&A.d1<=L.d1hi?'✓ inside':'<span class="err-crit">✕ outside</span>'):'—';
    return `<tr><td>${esc(x.title||'Untitled')}</td>${cell(L.d1,A.d1)}${cell(L.we,A.we)}${cell(L.wk,A.wk)}${cell(L.life,A.life)}<td class="n">${k}</td><td class="n">${inBand}</td></tr>`;}).join('')+'</tbody>';
  const errs=rows.filter(x=>x.actual.d1).map(x=>Math.abs(x.locked.d1-x.actual.d1)/x.actual.d1*100);
  const mape=errs.length?(errs.reduce((a,b)=>a+b,0)/errs.length):null;
  let note=mape!==null?'Mean absolute Day 1 error across '+errs.length+' film'+(errs.length===1?'':'s')+': '+mape.toFixed(0)+'%. ':'';
  if(ks.length){ks.sort((a,b)=>a-b);const med=ks[Math.floor(ks.length/2)];note+='Median implied k from actuals: '+med.toFixed(1)+' (current for this film: '+r.kInt.toFixed(1)+'). ';
    $('#accNote').innerHTML=note+`<button class="btn" id="applyK" style="margin-left:6px">Use k = ${med.toFixed(1)} for this film</button>`;
    $('#applyK').onclick=()=>{film().s.kInt=med.toFixed(1);dirty(film(),'signals','kInt');save();renderDesk();renderReadouts();flash('k updated');};}
  else $('#accNote').textContent=note+'Enter the opening-weekend actual to get an implied k.';
}
/* ---------- Tooltips ---------- */
const tip=$('#tip');
document.addEventListener('mousemove',e=>{const t=e.target.closest?.('[data-tip]');if(t){tip.textContent=t.dataset.tip;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';tip.classList.add('on');}else tip.classList.remove('on');});


/* ---------- Release calendar ---------- */
let calFilter='upcoming';
function renderCalendar(){
  const rows=state.calendar.map(c=>({...c,n:daysUntil(c.d)})).filter(c=>calFilter==='all'||(calFilter==='upcoming'?c.n>=0:c.n<0&&c.n>=-42)).sort((a,b)=>calFilter==='recent'?b.n-a.n:a.n-b.n);
  $('#calSource').textContent=state.calendar[0]?.source||'release calendar';
  const fmtD=iso=>new Date(iso+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  $('#calTable').innerHTML=`<thead><tr><th>Film</th><th>Release</th><th>Status</th><th>Cast</th><th>Director · banner</th><th></th></tr></thead><tbody>`+rows.map(c=>{
    const tracked=state.films.find(f=>f.calId===c.id||f.calKey===c.t);
    const st=c.n>0?`<span class="st">in ${c.n} day${c.n===1?'':'s'}</span>`:c.n===0?`<span class="st live">releases today</span>`:`<span class="st live">in cinemas · day ${1-c.n}</span>`;
    return `<tr><td><b>${esc(c.t)}</b></td><td><time datetime="${c.d}">${fmtD(c.d)}</time></td><td>${st}</td><td>${esc(c.cast)}</td><td><span style="color:var(--ink-3)">${esc(c.dir)} · ${esc(c.prod)}</span></td><td class="n"><button class="tr" data-cid="${c.id}" ${tracked?'disabled':''}>${tracked?'Tracking':'Track'}</button></td></tr>`;}).join('')+'</tbody>';
}
document.querySelector('.calf').addEventListener('click',e=>{const b=e.target.closest('.fbtn');if(!b)return;calFilter=b.dataset.f;document.querySelectorAll('.fbtn').forEach(x=>x.classList.toggle('on',x===b));renderCalendar();});
$('#calTable').addEventListener('click',e=>{
  const b=e.target.closest('.tr');if(!b||b.disabled)return;
  const c=state.calendar.find(x=>x.id===+b.dataset.cid);if(!c)return;
  api('POST','/films',{title:c.t,tag:c.cast,release_date:c.d,calendar_id:c.id,unfilled:true})
    .then(f=>{state.films.push(fromApi(f));state.active=f.id;remember();renderAll();flash('Tracking '+c.t+' — fill in its signals on the left');document.querySelector('#signals input[data-k="tr24"]')?.focus();}).catch(()=>{});
});

function renderAll(){renderTabs();renderDesk();renderReadouts();renderCalendar();$('#btnDel').hidden=!CFG.canManage;}


/* ---------- Boot ---------- */
load().then(renderAll).catch(e => { setSaveState('err', 'Could not load Pulse data — retry'); console.error(e); });
