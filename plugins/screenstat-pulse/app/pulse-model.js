/**
 * Screenstat Pulse — model core (extracted verbatim from the reference UI, v1.0, 7 Sep 2026)
 * Pure functions, no DOM. ES module. Port to PHP only if server-side computation is required;
 * the reference integration computes in the browser and stores inputs + outputs.
 *
 * compute(signals, samples) -> result   see HANDOVER.md §5 for every field
 * poolSamples(samples, bias)  -> pooled poll statistics with Wilson 95% CI
 * wilson(k, n, z)             -> [lo, p, hi]
 */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lognorm=(x,lo,hi)=>clamp(100*Math.log(Math.max(x,lo)/lo)/Math.log(hi/lo),0,100);
const sig=(x,mid,k)=>1/(1+Math.exp(-(x-mid)/k));
const DAY=864e5;
const todayIST=()=>{const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));d.setHours(0,0,0,0);return d;};
const daysUntil=iso=>Math.round((new Date(iso+'T00:00:00')-todayIST())/DAY);
/* ---------- Signal schema ---------- */
const GROUPS=[
 {id:'trailer',name:'Trailer',w:20,fields:[
  {k:'tr24',label:'Views in first 24 h',unit:'million',min:0,max:120,step:0.5,norm:v=>lognorm(v,0.2,60),w:12},
  {k:'trTotal',label:'Total views to date',unit:'million',min:0,max:400,step:1,norm:v=>lognorm(v,0.5,150),w:8},
  {k:'likeRatio',label:'Likes per 1,000 views',unit:'on YouTube',min:0,max:100,step:1,norm:null},
 ]},
 {id:'search',name:'Search & social',w:27,fields:[
  {k:'search',label:'Google Trends interest',unit:'0–100 vs a recent hit',min:0,max:100,step:1,norm:v=>v,w:12},
  {k:'posts',label:'Social posts per day',unit:'thousand · X + Instagram',min:0,max:1000,step:5,norm:v=>lognorm(v,1,500),w:15},
  {k:'sentiment',label:'Positive sentiment',unit:'% of posts',min:0,max:100,step:1,norm:null},
 ]},
 {id:'booking',name:'Booking intent',w:25,fields:[
  {k:'bms',label:'BookMyShow "interested"',unit:'thousand',min:0,max:3000,step:10,norm:v=>lognorm(v,5,1500),w:25},
 ]},
 {id:'music',name:'Music & star pull',w:20,fields:[
  {k:'song',label:'Top song streams/views',unit:'million',min:0,max:600,step:5,norm:v=>lognorm(v,1,300),w:8},
  {k:'star',label:'Star pull index',unit:'0–100 · lead cast’s recent openings',min:0,max:100,step:1,norm:v=>v,w:12},
 ]},
 {id:'quality',name:'Quality read',w:8,fields:[]},
];
const RELEASE=[
 {k:'screens',label:'Screens (India)',min:100,max:6000,step:50},
 {k:'shows',label:'Shows per screen/day',min:1,max:8,step:1},
 {k:'seats',label:'Avg seats per show',min:80,max:400,step:10},
 {k:'atp',label:'Avg ticket price (₹)',min:80,max:500,step:10},
 {k:'budget',label:'Budget incl. P&A (₹ cr)',min:1,max:800,step:5},
 {k:'days',label:'Days to release',min:0,max:120,step:1},
 {k:'release',label:'Release date',type:'date'},
];
const CAL=[
 {k:'kInt',label:'Interested → weekend footfalls (k)',min:0.5,max:6,step:0.1},
 {k:'bias',label:'Poll enthusiasm discount (×)',min:0.05,max:1,step:0.05},
];
const SOURCES={ig:['Instagram story poll',0.25],yt:['YouTube community poll',0.28],x:['X poll',0.22],web:['Website poll',0.35],exit:['Theatre-lobby / exit sample',0.30],wa:['WhatsApp / Telegram group',0.20],survey:['Structured survey (random sample)',0.80]};
const OPTS=[['def','Definitely, opening weekend'],['prob','Probably, in theatres later'],['ott','Will wait for OTT'],['no','Not interested']];


/* ---------- Model ---------- */
function compute(s,samples){
  if(s.release){s.days=Math.max(0,daysUntil(s.release));}
  const parts=[];let buzz=0;
  GROUPS.forEach(g=>g.fields.forEach(f=>{if(f.norm){const n=f.norm(+s[f.k]||0);const c=n*f.w/100;buzz+=c;parts.push({label:f.label,w:f.w,n,c});}}));
  const likeN=clamp((+s.likeRatio-15)/45,0,1);           // 15/1000 weak → 60/1000 superb
  const sentN=clamp((+s.sentiment-40)/45,0,1);            // 40% weak → 85% glowing
  const q=(likeN*0.45+sentN*0.55);
  buzz+=q*8; parts.push({label:'Quality (likes + sentiment)',w:8,n:q*100,c:q*8});
  buzz=clamp(buzz,0,100);

  // ---- Demand side (booking-intent signals)
  const kInt=+s.kInt||3.8;
  const bmsIntent=(+s.bms||0)*1e3*kInt;
  const uniqueAware=(+s.trTotal||0)*1e6*0.55 + (+s.posts||0)*1e3*7*0.8;
  const interestRate=0.03+0.11*q;
  const reachIntent=uniqueAware*interestRate;
  const intentDemand=(+s.bms>0)?bmsIntent*0.6+reachIntent*0.4:reachIntent;
  const d1Demand=intentDemand*0.40;

  // ---- Supply side (capacity × occupancy)
  const cap=(+s.screens||0)*(+s.shows||0)*(+s.seats||0);
  let occ=0.05+0.55*sig(buzz,60,11);
  if(s.holiday==='1')occ+=0.05; if(s.comp==='moderate')occ-=0.04; if(s.comp==='heavy')occ-=0.08;
  occ=clamp(occ,0.04,0.80);
  const d1Supply=cap*occ;

  // ---- Audience sample side (polls of movie-goers)
  const smp=poolSamples(samples||[],+s.bias||0.6);
  let d1Sample=null,intentSample=null;
  if(smp.n>0){intentSample=uniqueAware*smp.rateAdj;d1Sample=intentSample*0.40;}

  // ---- Triangulate with inverse-variance weights (log-space σ)
  const est=[{name:'Demand',v:d1Demand,sd:0.35},{name:'Supply',v:d1Supply,sd:0.25}];
  if(d1Sample&&d1Sample>0){est.push({name:'Audience',v:d1Sample,sd:Math.max(0.18,smp.relHalfWidth*1.6)});}
  let wsum=0,lsum=0;est.forEach(e=>{if(e.v>0){const w=1/(e.sd*e.sd);e.w=w;wsum+=w;lsum+=w*Math.log(e.v);}});
  est.forEach(e=>e.wn=e.w?e.w/wsum:0);
  const d1=Math.exp(lsum/wsum);
  const vals=est.filter(e=>e.v>0).map(e=>Math.log(e.v));
  const spreadLog=vals.length>1?Math.sqrt(vals.reduce((a,b)=>a+(b-Math.log(d1))**2,0)/(vals.length-1)):0;
  const sdD1=Math.sqrt(1/wsum+spreadLog*spreadLog*0.5);   // model σ + disagreement penalty
  const gap=Math.max(...est.map(e=>e.v))/Math.max(1,Math.min(...est.filter(e=>e.v>0).map(e=>e.v)))-1;
  const intent=intentSample?(intentDemand*0.5+intentSample*0.5):intentDemand;

  // ---- Day curve and holds (word of mouth)
  const atp=+s.atp||180;
  const wom=q;
  const hol=s.holiday==='1';
  const curve=(d1v,w,atpv)=>{const m=[1,hol?(0.85+0.3*w):(0.95+0.45*w)];m[2]=m[1]*(1.04+0.14*w);m[3]=m[2]*(0.36+0.16*w);m[4]=m[3]*(0.88+0.06*w);m[5]=m[4]*(0.9+0.05*w);m[6]=m[5]*(0.9+0.05*w);
    const days=m.map(x=>d1v*x);const gross=days.map(f=>f*atpv/1e7);const week1=gross.reduce((a,b)=>a+b,0);const lifeMult=1.45+1.15*w;return {days,gross,week1,weekend:gross[0]+gross[1]+gross[2],lifeMult,life:week1*lifeMult};};
  const base=curve(d1,wom,atp);

  // ---- Monte Carlo (2,000 draws) for P10 / P90
  const N=2000;const life=[],wk=[],we=[],d1s=[];const dayP=[[],[],[],[],[],[],[]];
  let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;};
  const gauss=()=>{let u=0,v=0;while(u===0)u=rnd();while(v===0)v=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
  for(let i=0;i<N;i++){const dv=d1*Math.exp(gauss()*sdD1);const wv=clamp(wom+gauss()*0.12,0,1);const av=atp*(1+gauss()*0.07);const c=curve(dv,wv,av);const lm=c.lifeMult*(1+gauss()*0.12);
    d1s.push(c.gross[0]);we.push(c.weekend);wk.push(c.week1);life.push(c.week1*lm);c.gross.forEach((g,j)=>dayP[j].push(g));}
  const pct=(arr,p)=>{const a=[...arr].sort((x,y)=>x-y);return a[Math.floor(p*(a.length-1))];};
  const mc={d1:[pct(d1s,.1),pct(d1s,.5),pct(d1s,.9)],weekend:[pct(we,.1),pct(we,.5),pct(we,.9)],week1:[pct(wk,.1),pct(wk,.5),pct(wk,.9)],life:[pct(life,.1),pct(life,.5),pct(life,.9)],days:dayP.map(a=>[pct(a,.1),pct(a,.5),pct(a,.9)])};

  const budget=+s.budget||1;
  const ratio=mc.life[1]/budget;
  const verdict=ratio<0.8?['Flop risk','crit']:ratio<1.1?['Average','warn']:ratio<1.5?['Hit','good']:ratio<2?['Super hit','good']:['Blockbuster','good'];
  const pHit=life.filter(v=>v/budget>=1.1).length/N;
  return {buzz,parts,q,intent,intentDemand,intentSample,uniqueAware,interestRate,bmsIntent,reachIntent,d1Demand,d1Supply,d1Sample,est,d1,sdD1,gap,cap,occ,
    days:base.days,gross:mc.days.map(d=>d[1]),week1:mc.week1[1],weekend:mc.weekend[1],life:mc.life[1],lifeMult:base.lifeMult,mc,ratio,verdict,pHit,atp,wom,smp,kInt};
}
function wilson(k,n,z=1.96){if(!n)return [0,0,0];const p=k/n,d=1+z*z/n,c=p+z*z/(2*n),h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));return [(c-h)/d,p,(c+h)/d];}
function poolSamples(samples,bias){
  let n=0,def=0,prob=0,ott=0,no=0;
  samples.forEach(x=>{n+=+x.n||0;def+=+x.def||0;prob+=+x.prob||0;ott+=+x.ott||0;no+=+x.no||0;});
  if(!n)return {n:0};
  // weight each sample's bias by its share of respondents
  let bw=0;samples.forEach(x=>{bw+=(+x.n||0)*(SOURCES[x.src]?.[1]||0.6);});bw/=n;
  const eff=bias*bw/0.25;                                  // slider is relative to the 0.25 reference (follower-poll) source
  const [lo,p,hi]=wilson(def,n);
  const rateRaw=p+0.15*(prob/n);
  const rateAdj=clamp(rateRaw*eff,0,1);
  const relHalfWidth=p>0?((hi-lo)/2)/p:1;
  return {n,def,prob,ott,no,p,lo,hi,pProb:prob/n,pOtt:ott/n,pNo:no/n,rateRaw,rateAdj,eff,relHalfWidth,moe:(hi-lo)/2};
}

export { daysUntil, compute, poolSamples, wilson, GROUPS, RELEASE, CAL, SOURCES, OPTS, lognorm, sig, clamp };
