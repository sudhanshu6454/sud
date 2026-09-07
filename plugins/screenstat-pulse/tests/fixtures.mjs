import { compute } from '../app/pulse-model.js';
const EX = [
 {id:'raktdhaar', s:{tr24:38,trTotal:96,likeRatio:41,search:82,posts:210,sentiment:71,bms:1400,song:140,star:84,screens:4200,shows:5,seats:200,atp:240,budget:260,days:12,holiday:'1',comp:'none',kInt:3.8,bias:0.25},
  samples:[{src:'ig',n:2140,def:920,prob:640,ott:400,no:180},{src:'yt',n:860,def:361,prob:249,ott:172,no:78},{src:'x',n:1310,def:590,prob:360,ott:230,no:130}]},
 {id:'dilli', s:{tr24:9,trTotal:31,likeRatio:33,search:41,posts:38,sentiment:64,bms:140,song:62,star:48,screens:2100,shows:4,seats:190,atp:190,budget:70,days:5,holiday:'0',comp:'moderate',kInt:3.8,bias:0.25},
  samples:[{src:'ig',n:640,def:141,prob:198,ott:224,no:77}]},
 {id:'kaali', s:{tr24:2.4,trTotal:11,likeRatio:52,search:22,posts:12,sentiment:79,bms:46,song:9,star:22,screens:900,shows:3,seats:170,atp:160,budget:22,days:26,holiday:'0',comp:'heavy',kInt:3.8,bias:0.25}, samples:[]},
 {id:'tracked-defaults', s:{tr24:0,trTotal:0,likeRatio:35,search:0,posts:0,sentiment:60,bms:0,song:0,star:50,screens:2000,shows:4,seats:190,atp:190,budget:60,days:30,holiday:'0',comp:'none',kInt:3.8,bias:0.25}, samples:[]},
 {id:'strings', s:{tr24:'38',trTotal:'96',likeRatio:'41',search:'82',posts:'210',sentiment:'71',bms:'1400',song:'140',star:'84',screens:'4200',shows:'5',seats:'200',atp:'240',budget:'260',days:'12',holiday:'1',comp:'none',kInt:'3.8',bias:'0.25'}, samples:[]},
];
const out = {};
for (const e of EX) {
  for (const [label, smp] of [['nosamples', []], ['samples', e.samples]]) {
    if (label === 'samples' && !e.samples.length) continue;
    const r = compute({...e.s}, smp.map(x => ({...x})));
    out[`${e.id}:${label}`] = { buzz: r.buzz, q: r.q, intent: r.intent, d1: r.d1, sdD1: r.sdD1, occ: r.occ, gap: r.gap, life: r.life, weekend: r.weekend, week1: r.week1,
      mc: r.mc, ratio: r.ratio, verdict: r.verdict[0], pHit: r.pHit, est: r.est.map(x => ({name: x.name, v: x.v, sd: x.sd, wn: x.wn})), smp: r.smp.n ? {n: r.smp.n, p: r.smp.p, lo: r.smp.lo, hi: r.smp.hi, rateAdj: r.smp.rateAdj, eff: r.smp.eff, relHalfWidth: r.smp.relHalfWidth} : {n: 0} };
  }
}
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./fixtures.json', import.meta.url), JSON.stringify(out, null, 1));
const r = out['raktdhaar:samples'], n = out['raktdhaar:nosamples'];
console.log('Raktdhaar +samples: buzz', r.buzz.toFixed(1), 'intent', (r.intent/1e5).toFixed(1), 'lakh · life', r.life.toFixed(2), '· d1', r.mc.d1[1].toFixed(2));
console.log('Raktdhaar no samples: buzz', n.buzz.toFixed(1), 'life', n.life.toFixed(2), 'd1', n.mc.d1.map(v=>v.toFixed(2)));
