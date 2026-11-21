// Indicator definitions and scoring are ported from advisor/{indicators,factors,scoring,engine}.py.
export const horizons = [
  {key:'short', title:'Краткосрочно', span:'1–7 дней', days:7},
  {key:'medium', title:'Среднесрочно', span:'2 недели – 3 месяца', days:30},
  {key:'long', title:'Долгосрочно', span:'От полугода', days:180}
];
export const dayMs = 86400000;
export const utcDay = time => new Date(time).toISOString().slice(0,10);
export const finite = Number.isFinite;
const clip = v => Math.max(-100, Math.min(100, v));
const avg = xs => xs.reduce((s,v) => s+v,0)/xs.length;
const ratio = (a,b) => finite(a) && finite(b) && b !== 0 ? a/b-1 : NaN;

function windowValues(xs, end, length, min=length) {
  const w = xs.slice(Math.max(0,end-length+1),end+1).filter(finite);
  return w.length >= min ? w : [];
}
const meanAt = (xs,i,n,min=n) => avg(windowValues(xs,i,n,min));
function stdAt(xs,i) {
  const w=windowValues(xs,i,30,20), mean=avg(w);
  return w.length ? Math.sqrt(w.reduce((s,v)=>s+(v-mean)**2,0)/(w.length-1)*365) : NaN;
}

export function indicators(candles) {
  const close=candles.map(c=>c.close), volume=candles.map(c=>c.volume>0?c.volume:NaN);
  const returns=close.map((c,i)=>ratio(c,close[i-1]));
  let fast=close[0], slow=close[0], signal=0, up=NaN, down=NaN;
  const rows=[];
  for (let i=0;i<close.length;i++) {
    const c=close[i], diff=c-close[i-1];
    if (i>0) {
      const gain=Math.max(0,diff), loss=Math.max(0,-diff);
      up=i===1?gain:(13*up+gain)/14;
      down=i===1?loss:(13*down+loss)/14;
    }
    fast+=(c-fast)*2/13; slow+=(c-slow)*2/27;
    const macd=fast-slow;
    signal+=(macd-signal)*2/10;
    const highs=windowValues(close,i,365,30);
    const row={...candles[i], ma20:meanAt(close,i,20),ma50:meanAt(close,i,50),ma200:meanAt(close,i,200),
      rsi:i>=14 && down>0 ? 100-100/(1+up/down) : NaN,
      macd,hist:macd-signal,vol30:stdAt(returns,i),vol_ratio:meanAt(volume,i,7,5)/meanAt(volume,i,30,20),
      dd365:highs.length?ratio(c,Math.max(...highs)):NaN};
    for(const n of [1,7,30,90,180]) row['ret'+n]=ratio(c,close[i-n]);
    rows.push(row);
  }
  return rows;
}

export function context(rows, btc, fear, funding) {
  const byDate=new Map(btc.map(r=>[r.day,r]));
  const fearValues=[], funds=[];
  let lastFear=NaN, lastFunding=NaN, fearDay=-Infinity, fundDay=-Infinity;
  return rows.map((r,i)=>{
    const day=Date.parse(r.day)/dayMs, b=byDate.get(r.day);
    if(fear.has(r.day)){lastFear=fear.get(r.day);fearDay=day;}
    if(funding.has(r.day)){lastFunding=funding.get(r.day);fundDay=day;}
    const fng=day-fearDay<=3?lastFear:NaN;
    fearValues.push(fng); funds.push(day-fundDay<=2?lastFunding:NaN);
    const fng30=meanAt(fearValues,i,30,10), fund=meanAt(funds,i,3,1)*100;
    const c=r.close, r7=r.ret7*100, r30=r.ret30*100, rel=(r.ret180-(b?.ret180??NaN))*100;
    const up20=r.ma20>rows[i-5]?.ma20, past50=rows[i-10]?.ma50;
    const conditions={
      rsi_lt30:r.rsi<30,rsi_30_40:r.rsi>=30&&r.rsi<40,rsi_65_75:r.rsi>65&&r.rsi<=75,rsi_gt75:r.rsi>75,
      ma20_up:c>r.ma20&&up20,ma20_down:c<r.ma20&&!up20,macd_up:r.hist>0&&r.hist>rows[i-3]?.hist,
      macd_down:r.hist<0&&r.hist<rows[i-3]?.hist,pump7:r7>30,dump7:r7< -25,vol_up:r.vol_ratio>1.4&&r7>3,
      vol_down:r.vol_ratio>1.4&&r7< -3,pump30:r30>80,up30:r30>10&&r30<=80,dump30:r30< -30,
      above_ma50:c>r.ma50,below_ma50:c<=r.ma50,ma50_up:r.ma50>past50*1.01,ma50_down:r.ma50<past50*.99,
      above_ma200:c>r.ma200,below_ma200:c<=r.ma200,golden:r.ma50>r.ma200,death:r.ma50<=r.ma200,
      near_high:r.dd365>-.05,deep_dd:r.dd365<-.60,rel_strong:rel>20,rel_weak:rel< -30,high_vol:r.vol30>1.2,
      fng_fear:fng<=25,fng_greed:fng>=75,fng30_fear:fng30<=30,fng30_greed:fng30>=70,
      btc_above_ma200:b?.close>b?.ma200,btc_below_ma200:b?.close<=b?.ma200,
      btc_above_ma50:b?.close>b?.ma50,btc_below_ma50:b?.close<=b?.ma50,funding_high:fund>.03,funding_neg:fund<-.005
    };
    const features={...r,d_ma20:ratio(c,r.ma20),d_ma50:ratio(c,r.ma50),d_ma200:ratio(c,r.ma200),
      ma50_slope:ratio(r.ma50,past50),ma200_slope:ratio(r.ma200,rows[i-20]?.ma200),
      ma50_vs_200:ratio(r.ma50,r.ma200),macd_n:r.macd/c,macd_hist_n:r.hist/c,
      rel7:r.ret7-(b?.ret7??NaN),rel30:r.ret30-(b?.ret30??NaN),rel90:r.ret90-(b?.ret90??NaN)};
    return {r,fng,fund,features,active:Object.keys(conditions).filter(k=>conditions[k]),bull:conditions.btc_above_ma200};
  });
}

export function predict(model, features) {
  const x=model.features.map(k=>features[k]);
  let sum=0;
  for(const tree of model.trees) {
    let node=0;
    while(node>=0) {
      const type=tree.decision_type[node], value=x[tree.split_feature[node]];
      const missingType=type>>2;
      const missing=!finite(value);
      const left=missing && missingType===2 ? (type&2)!==0 : (missing?0:value)<=Number(tree.threshold[node]);
      node=(left?tree.left_child:tree.right_child)[node];
    }
    sum+=tree.leaf_value[~node];
  }
  return 1/(1+Math.exp(-sum));
}

export function verdict(score) {
  if(score>=50)return 'Хороший момент для покупки';
  if(score>=15)return 'Можно понемногу докупать';
  if(score>=-15)return 'Ждать — явного сигнала нет';
  if(score>=-50)return 'Осторожно, лучше не покупать';
  return 'Высокий риск — лучше не покупать';
}
function weight(mode,pooled,regime) {
  return mode==='pooled'?pooled:mode==='regime'?regime:(pooled+regime)/2;
}
export function score(ctx, isBtc, models, labels, length) {
  const bull=isBtc?ctx.active.includes('above_ma200'):ctx.bull;
  const active=ctx.active.filter(f=>!isBtc||!f.startsWith('btc_'));
  return horizons.map(({key})=>{
    const h=models.factors.horizons[key], regional=bull?h.weights_bull:h.weights_bear;
    const reasons=[];
    for(const f of active) {
      const p=h.weights[f], r=regional[f], w=weight(h.mode,p.points,r.points);
      if(Math.abs(w)<.5)continue;
      const stat=h.mode==='pooled'?p:r;
      reasons.push({title:labels[f],points:w,note:'Эффект за период '+stat.effect.toFixed(1)+'% · совпадений по годам '+stat.agree+'/'+stat.years});
    }
    if(key==='long'){
      const days=(Date.parse(ctx.r.day)-Date.parse('2024-04-20'))/dayMs;
      const pts=days<365?8:days<550?0:days<800?-8:days<1100?8:5;
      if(pts)reasons.push({title:'Фаза цикла халвинга BTC',points:pts,note:'Эвристика настольной версии по нескольким циклам'});
    }
    const rules=clip(reasons.reduce((s,r)=>s+r.points,0));
    const prob=length>30?predict(models[key],ctx.features):null;
    const w=prob===null?0:models.report.horizons[key].weight;
    const combined=w?(1-w)*rules+w*clip((prob-.5)*400):rules;
    const reliability=h.reliability[0];
    const factor=({'средняя':1,'ниже средней':.8,'низкая':.6})[reliability]??.6;
    const total=combined*factor;
    return {key,total,prob,weight:w,reliability,verdict:verdict(total),reasons:reasons.sort((a,b)=>Math.abs(b.points)-Math.abs(a.points))};
  });
}

function historicalScore(ctx, isBtc, factors) {
  const year=ctx.r.day.slice(0,4), bull=isBtc?ctx.active.includes('above_ma200'):ctx.bull;
  const totals=[];
  for(const key of ['medium','long']){
    const h=factors.horizons[key], yearly=h.wf_points[year];
    if(!yearly) return NaN;
    let total=0;
    for(const f of ctx.active){
      if(isBtc&&f.startsWith('btc_'))continue;
      total+=weight(h.mode,yearly.pooled[f]??0,yearly[bull?'bull':'bear'][f]??0);
    }
    totals.push(clip(total));
  }
  return avg(totals);
}
export function simulate(series, isBtc, factors, start, weekly, fear=25, greed=75) {
  if(!finite(weekly)||weekly<=0||fear>=greed)throw Error('Проверьте сумму и пороги.');
  const days=series.filter(s=>s.r.day>=start&&new Date(s.r.day).getUTCDay()===1);
  if(days.length<8)throw Error('Для сравнения нужно хотя бы восемь понедельников.');
  const final=series[series.length-1].r.close;
  const result=['Еженедельно','По индексу страха','По оценке советника','Всё в начале'].map(title=>({title,invested:0,units:0}));
  for(const c of days){
    const adv=historicalScore(c,isBtc,factors);
    const mult=[1,c.fng<=fear?1.5:c.fng>=greed?.5:1,adv>=15?1.5:adv<=-15?.5:1];
    mult.forEach((m,i)=>{const amount=weekly*m;result[i].invested+=amount;result[i].units+=amount/c.r.close;});
  }
  result[3].invested=result[0].invested; result[3].units=result[3].invested/days[0].r.close;
  return result.map(r=>({...r,value:r.units*final,ret:(r.units*final/r.invested-1)*100}));
}
