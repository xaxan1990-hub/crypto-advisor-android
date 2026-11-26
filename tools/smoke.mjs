// UI smoke test on the APK running inside an Android emulator. The market fixture is isolated to this page.
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

let page;
for(let i=0;i<60&&!page;i++){
  try{page=(await (await fetch('http://localhost:9222/json/list')).json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);}
  catch{}
  if(!page)await delay(500);
}
assert.ok(page,'Android WebView debugging target');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let seq=0;
const waiters=new Map(),exceptions=[];
ws.onmessage=({data})=>{
  const m=JSON.parse(data);
  if(m.id&&waiters.has(m.id)){const w=waiters.get(m.id);waiters.delete(m.id);if(m.error)w.reject(Error(m.error.message));else w.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
};
function send(method,params={}){
  const id=++seq;return new Promise((resolve,reject)=>{waiters.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
}
async function exec(expression){
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result.value;
}
async function until(condition){
  for(let i=0;i<100;i++){if(await exec(condition))return;await delay(200);}
  throw Error('UI timeout: '+condition+'\n'+await exec('document.body.innerText.slice(0,1500)')+'\n'+exceptions.join('\n'));
}
function marketFixture(){
  const original=window.fetch.bind(window),dayMs=86400000,now=Date.now(),last=Math.floor(now/dayMs)*dayMs;
  window.fetch=async(input,options)=>{
    const uri=new URL(input,location.href);
    if(!uri.pathname.startsWith('/data/'))return original(input,options);
    const kind=uri.pathname.split('/').pop(),ticker=uri.searchParams.get('id');
    const candles=Array.from({length:450},(_,i)=>{
      const price=200+i*.1+Math.sin(i*.5)*5,t=last-(449-i)*dayMs;
      return [t,price,price,price,price,0,t+dayMs-1,100000+i*3];
    });
    const c=candles.at(-1)[4];
    const market=[['bitcoin','btc','Bitcoin'],['ethereum','eth','Ethereum']].map(([id,symbol,name])=>({
      id,symbol,name,current_price:c,market_cap:1e9,price_change_percentage_24h:3,
      price_change_percentage_7d_in_currency:6,price_change_percentage_30d_in_currency:12,last_updated:new Date(now).toISOString()}));
    const payload={market,candles,funding:[],fear:{data:[0,1,2].map(i=>({timestamp:(last/dayMs-i)*86400,value:'24'}))},
      fx:{Date:'2026-11-27T11:30:00+03:00',Valute:{USD:{Nominal:1,Value:80}}},
      fx_usdt:{tether:{rub:80}},
      release:{tag_name:'v0.4.0',html_url:'https://github.com/xaxan1990-hub/crypto-advisor-android/releases/tag/v0.4.0'},
      search:{coins:[{id:'pepe',symbol:'pepe',name:'Pepe',market_cap_rank:52}]},
      price:{pepe:{usd:0.00001,last_updated_at:Math.floor(now/1000)}},
      news:'<rss><channel><item><title>Bitcoin ETF approval</title><link>https://example.org/test</link></item></channel></rss>'};
    return new Response(JSON.stringify({at:now,data:payload[kind]}),{headers:{'Content-Type':'application/json'}});
  };
}
const click=async selector=>{const q=JSON.stringify(selector);await until('!!document.querySelector('+q+')');await exec('document.querySelector('+q+').click()');};
try{
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'('+marketFixture.toString()+')()'});
  await send('Page.reload',{ignoreCache:true});
  await until("document.querySelectorAll('.coin').length===2");
  await click('[data-act="coin"][data-id="bitcoin"]');
  await until("document.body.innerText.includes('Факторы и модель') && document.querySelectorAll('details').length===3");
  assert.ok(await exec("document.querySelectorAll('.chart rect').length")>60,'candlestick chart');
  await click('[data-act="sim"]');await click('#sim-form button');
  await until("document.querySelector('#simulation')?.innerText.includes('Всё в начале')");
  await exec('window.advisorBack()');
  await click('[data-act="add"]');
  await until("!!document.querySelector('#tx-form')");
  await exec("document.querySelector('[name=qty]').value='2';document.querySelector('[name=rub]').value='200000';document.querySelector('#tx-form').requestSubmit()");
  await until("document.body.innerText.includes('Операции') && !!document.querySelector('[data-act=askdelete]')");
  await click('[data-act="askedit"]');
  await until("document.body.innerText.includes('Редактировать операцию')");
  await exec("document.querySelector('[name=fee]').value='500';document.querySelector('#tx-form').requestSubmit()");
  await until("document.body.innerText.includes('комиссия')");
  await click('[data-act="add"]');
  await click('[data-act="txtype"][data-id="sell"]');
  await exec("document.querySelector('[name=qty]').value='0.5';document.querySelector('[name=rub]').value='60000';document.querySelector('#tx-form').requestSubmit()");
  await until("document.body.innerText.includes('Продажа') && document.querySelectorAll('[data-act=askdelete]').length===2");
  await send('Page.reload',{ignoreCache:true});
  await until("document.querySelectorAll('.coin').length===2");
  await click('[data-tab="portfolio"]');await until("!!document.querySelector('[data-act=askdelete]')");
  await click('[data-tab="research"]');await until("document.body.innerText.includes('BTC · 7 дн.')");
  await click('[data-tab="news"]');await until("document.body.innerText.includes('Bitcoin ETF approval')");
  await click('[data-tab="portfolio"]');
  await click('[data-act="add"]');
  await until("!!document.querySelector('#coin-search')");
  await exec("const q=document.querySelector('#coin-search');q.value='pepe';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-act=coinsearch]').click()");
  await until("!!document.querySelector('[data-act=pickcoin]')");
  await click('[data-act="pickcoin"]');
  await until("document.querySelector('#tx-coin').value==='pepe'");
  await exec("document.querySelector('[name=qty]').value='1000000';document.querySelector('[name=rub]').value='800';document.querySelector('#tx-form').requestSubmit()");
  await until("document.body.innerText.includes('PEPE') && document.body.innerText.includes('Операции')");
  await until("document.body.innerText.includes('Чистые вложения')");
  await click('[data-tab="market"]');
  await exec("const input=document.querySelector('#search');input.value='eth';input.dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await exec("document.querySelectorAll('.coin').length"),1);
  assert.equal(await exec("document.querySelector('.coin').dataset.id"),'ethereum');
  assert.deepEqual(exceptions,[]);
  console.log('Android WebView passed: market, candles, models, simulator, purchase, edit, fees, restart, custom coin, journal, RSS and search.');
}finally{ws.close();}
