import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dayMs,utcDay,indicators,context,predict,score,simulate,verdict} from '../app/src/main/assets/analysis.js';
import {marketRows,fearMap,fundingMap} from '../app/src/main/assets/data.js';
const asset=(name)=>JSON.parse(readFileSync(new URL('../app/src/main/assets/models/'+name+'.json',import.meta.url)));
const models=Object.fromEntries(['config','factors','report','short','medium','long'].map(k=>[k,asset(k)]));
const prices=Array.from({length:450},(_,i)=>({day:utcDay(Date.UTC(2025,0,1)+i*dayMs),close:100+i*.2+Math.sin(i*.6)*7,volume:10000+i*3}));
const rows=indicators(prices),series=context(rows,rows,new Map(),new Map());
test('moving windows and sample volatility use past daily closes',()=>{
  assert.ok(Number.isNaN(rows[198].ma200));
  assert.equal(rows[199].ma200,prices.slice(0,200).reduce((a,p)=>a+p.close,0)/200);
  const last=rows.at(-1);
  assert.equal(last.ret7,prices.at(-1).close/prices.at(-8).close-1);
  assert.equal(last.rsi.toFixed(6),referenceRsi(prices).toFixed(6));
  assert.ok(last.vol30>0);
});
function referenceRsi(prices){
  let gains=0,losses=0;
  const last=prices.length-1,alpha=1/14;
  for(let i=1;i<=last;i++){
    const d=prices[i].close-prices[i-1].close;
    const w=(i===1?1:alpha)*(1-alpha)**(last-i);
    gains+=Math.max(0,d)*w;losses+=Math.max(0,-d)*w;
  }
  return 100-100/(1+gains/losses);
}
test('missing market context stays missing and never contributes bear/fear signals',()=>{
  const series=context(rows,[],new Map(),new Map());
  assert.ok(!series.at(-1).active.some(k=>/^(btc_|fng|funding|rel_)/.test(k)));
  const recent=new Map([[rows.at(-5).day,0]]);
  const signaled=context(rows,[],recent,new Map());
  assert.ok(signaled.at(-2).active.includes('fng_fear'));
  assert.ok(!signaled.at(-1).active.includes('fng_fear'));
});
test('numeric LightGBM branches preserve missing values, boundaries and infinities',()=>{
  const tree={split_feature:[0],threshold:[1],decision_type:[8],left_child:[-1],right_child:[-2],leaf_value:[-1,2]};
  const model={features:['x'],trees:[tree]},sig=x=>1/(1+Math.exp(-x));
  assert.equal(predict(model,{x:1}),sig(-1));assert.equal(predict(model,{}),sig(2));
  tree.decision_type[0]=10;assert.equal(predict(model,{}),sig(-1));
  tree.decision_type[0]=2;tree.threshold[0]=-.1;assert.equal(predict(model,{}),sig(2));
  tree.threshold[0]='Infinity';assert.equal(predict(model,{x:1e9}),sig(-1));
});
test('shipped model scores use its walk-forward reliability; BTC has no duplicate benchmark factors',()=>{
  const cards=score(series.at(-1),true,models,models.config.SHORT,rows.length);
  assert.equal(cards.length,3);
  for(const c of cards){
    assert.equal(models[c.key].trees.length,250);
    assert.ok(c.prob>0&&c.prob<1);assert.ok(Math.abs(c.total)<=100);
    assert.ok(c.reasons.every(r=>typeof r.title==='string'&&!r.title.startsWith('BTC выше')));
    const rules=Math.max(-100,Math.min(100,c.reasons.reduce((s,r)=>s+r.points,0)));
    const m=Math.max(-100,Math.min(100,(c.prob-.5)*400));
    const reliability={'средняя':1,'ниже средней':.8,'низкая':.6}[c.reliability];
    assert.ok(Math.abs(((1-c.weight)*rules+c.weight*m)*reliability-c.total)<1e-10);
  }
  assert.match(verdict(15),/докупать/);assert.match(verdict(-15),/Ждать/);
});
test('flat and lump strategies invest equal dollars; no future weights are used when history is missing',()=>{
  const vintage={horizons:{medium:{wf_points:{}},long:{wf_points:{}}}};
  const r=simulate(series,true,vintage,'2025-04-01',75);
  assert.equal(r.length,4);assert.equal(r[0].invested,r[3].invested);
  assert.equal(r[0].value,r[2].value);assert.equal(r[0].value,r[1].value);
  assert.throws(()=>simulate(series,true,vintage,'2027-01-01',100));
});
test('market exclusions, zero fear and daily average funding match source semantics',()=>{
  const base={current_price:9,price_change_percentage_24h:4,market_cap:5,last_updated:'2026-11-20T12:00:00Z'};
  const coins=marketRows([{...base,id:'bitcoin',name:'Bitcoin',symbol:'btc'},{...base,id:'st',name:'Wrapped Bitcoin',symbol:'ww'},{...base,id:'t',name:'Tether',symbol:'usdt'}],models.config);
  assert.deepEqual(coins.map(c=>c.id),['bitcoin']);
  assert.equal(fearMap([{timestamp:'86400',value:'0'}]).get('1970-01-02'),0);
  assert.equal(fundingMap([{fundingTime:1000,fundingRate:'.002'},{fundingTime:2000,fundingRate:'.004'}]).get('1970-01-01'),.003);
});
