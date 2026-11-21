import {utcDay,dayMs,context,score,simulate,finite} from './analysis.js';
import {loadModels,request,marketRows,fearMap,fundingMap,history,newsFeeds,recordJournal,journalRows} from './data.js';
import * as view from './views.js';

const main=document.querySelector('#main');
const s={tab:'market',selected:null,models:null,coins:[],fear:new Map(),results:new Map(),query:'',sort:'rank',range:365,
  buys:[],buyCoin:null,remove:null,news:null,important:false,journal:null,bulk:false,bulkNote:'',today:utcDay(Date.now())};
let refreshJob,newsJob,journalTicket=0,epoch=0,bulkTicket=0,loading=new Map(),histories=new Map(),fearJob;
let marketFromDisk=false,toastTimeout,portfolioLocked=false;
function toast(text){
  const el=document.querySelector('#message');el.textContent=text;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.textContent='',4500);
}
function render(){
  if(!s.models)return;
  s.today=utcDay(Date.now());
  const tab=s.tab==='detail'||s.tab==='sim'?'market':s.tab==='add'?'portfolio':s.tab;
  document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  main.innerHTML=({market:view.market,detail:view.detail,news:view.news,portfolio:view.portfolio,add:view.buyForm,sim:view.simulator,research:view.research})[s.tab](s);
  document.querySelector('#refresh').disabled=!!refreshJob||!!newsJob;
}
function safeMarketRender(){
  // Keep keyboard focus and cursor while updated scores arrive.
  if(s.tab!=='market')return;
  if(document.activeElement?.id==='search'){
    document.querySelector('#coin-list').innerHTML=view.coinRows(s);return;
  }
  render();
}
function go(tab){
  s.tab=tab;s.remove=null;window.scrollTo(0,0);render();
  if(tab==='news'&&!s.news)loadNews(false);
  if(tab==='research')readJournal();
}
async function readJournal(){
  const ticket=++journalTicket;
  try{s.journal=await journalRows();}catch{s.journal=[];toast('Хранилище журнала недоступно.');}
  if(s.tab==='research'&&ticket===journalTicket)render();
}
function getHistory(coin,refresh){
  if(!histories.has(coin.id)){
    const map=histories;
    map.set(coin.id,history(coin,refresh).catch(e=>{map.delete(coin.id);throw e;}));
  }
  return histories.get(coin.id);
}
async function analyze(coin,refresh=false){
  if(s.results.has(coin.id))return s.results.get(coin.id);
  if(loading.has(coin.id))return loading.get(coin.id);
  const generation=epoch, tasks=loading;
  const job=(async()=>{
    const btc=s.coins.find(c=>c.id==='bitcoin');
    const [data,benchmark,fear,fund]=await Promise.all([
      getHistory(coin,refresh), btc?getHistory(btc,refresh).catch(()=>null):null, fearJob,
      request('funding',coin.symbol,refresh).catch(()=>null)
    ]);
    if(generation!==epoch)return null;
    const matchedFunding=data.source==='Binance' ? fund : null;
    const series=context(data.rows,benchmark?.rows||[],fear?.map||new Map(),matchedFunding?fundingMap(matchedFunding.data):new Map());
    const last=series.at(-1), isBtc=coin.id==='bitcoin';
    const cards=score(last,isBtc,s.models,s.models.config.SHORT,series.length);
    const missing=[...(!benchmark?['история BTC']:[]),...(!fear?['индекс страха']:[]),...(!matchedFunding?['funding']:[])];
    const stale=!!(data.stale||benchmark?.stale||fear?.stale||fund?.stale);
    const result={series,cards,source:data.source,stale,missing};
    s.results.set(coin.id,result);
    const age=Date.now()-coin.at;
    const canRecord=!marketFromDisk&&!stale&&age>=-300000&&age<dayMs&&last.r.day===utcDay(Date.now()-dayMs);
    try{await recordJournal(coin,cards,data.rows,canRecord);}catch{toast('Не удалось сохранить прогноз в журнале.');}
    return result;
  })();
  tasks.set(coin.id,job);
  try{return await job;}finally{tasks.delete(coin.id);}
}
async function openCoin(id,refresh=false){
  const coin=s.coins.find(c=>c.id===id);if(!coin)return;
  s.selected=id;s.detailError='';s.range=365;go('detail');
  try{await analyze(coin,refresh);}catch{if(s.selected===id)s.detailError='История цен недоступна. Проверьте соединение или повторите позже.';}
  if(s.tab==='detail'&&s.selected===id)render();
}
async function marketRefresh(force=false){
  if(refreshJob)return refreshJob;
  const next=(async()=>{
    try{
      const pack=await request('market','',force),coins=marketRows(pack.data,s.models.config);
      if(!coins.length)throw Error('Пустой рейтинг');
      const wanted=s.selected;
      epoch++;bulkTicket++;s.bulk=false;s.bulkNote='';loading=new Map();histories=new Map();
      s.coins=coins;s.results=new Map();s.marketTime=pack.at;s.stale=!!pack.stale;marketFromDisk=!!pack.stale;s.marketError='';
      if(!coins.some(c=>c.id===wanted)&&['detail','sim'].includes(s.tab))s.tab='market';
      s.fear=new Map();
      fearJob=request('fear','',force).then(x=>({map:fearMap(x.data.data),stale:!!x.stale})).catch(()=>null);
      const current=epoch;
      fearJob.then(f=>{if(f&&epoch===current){s.fear=f.map;safeMarketRender();}});
      if(s.tab!=='add')render();
      const id=['detail','sim'].includes(s.tab)?wanted:'bitcoin',target=coins.find(c=>c.id===id);
      if(target){
        try{await analyze(target,force);}catch{if(s.selected===id)s.detailError='История цен недоступна.';}
      }
    }catch{
      s.marketError='Не удалось загрузить рейтинг CoinGecko. Проверьте интернет или повторите позже.';
      if(s.coins.length){s.stale=true;marketFromDisk=true;toast(s.marketError);}
    }
  })();
  refreshJob=next;
  try{await next;}finally{
    refreshJob=null;
    if(['market','detail','sim','portfolio'].includes(s.tab))render();
    else document.querySelector('#refresh').disabled=!!newsJob;
  }
}
async function loadNews(force){
  if(newsJob)return;
  newsJob=newsFeeds(s.models.config,force);
  try{s.news=await newsJob;}catch{s.news={items:[],sources:0,total:9};}
  finally{newsJob=null;if(s.tab==='news')render();else document.querySelector('#refresh').disabled=!!refreshJob;}
}
async function bulk(){
  if(s.bulk){s.bulk=false;bulkTicket++;s.bulkNote='Расчёт остановлен.';render();return;}
  const ticket=++bulkTicket,todo=s.coins.filter(c=>!s.results.has(c.id));let failed=0;
  s.bulk=true;s.bulkNote='Загружаем историю монет…';render();
  const worker=async()=>{
    while(s.bulk&&ticket===bulkTicket&&todo.length){
      const coin=todo.shift();
      try{await analyze(coin);}catch{failed++;}
      if(ticket===bulkTicket)safeMarketRender();
    }
  };
  await Promise.all([worker(),worker()]);
  if(ticket===bulkTicket){s.bulk=false;s.bulkNote=failed?'Без доступной истории: '+failed+'.':'Расчёт завершён.';safeMarketRender();}
}
function storeBuys(next){
  if(portfolioLocked){toast('Исходные записи портфеля не удалось прочитать.');return false;}
  try{localStorage.setItem('portfolio-v1',JSON.stringify(next));s.buys=next;return true;}
  catch{toast('Хранилище заполнено. Изменения не сохранены.');return false;}
}

document.addEventListener('click',event=>{
  const el=event.target.closest('button');if(!el||!s.models)return;
  const {tab,act,id}=el.dataset;
  if(tab){go(tab);return;}
  if(el.id==='refresh'||act==='refresh'){
    if(s.tab==='news')loadNews(true);
    else if(s.tab==='research')readJournal();
    else if(s.tab!=='add')marketRefresh(true);
    return;
  }
  switch(act){
    case 'market':case 'portfolio':go(act);break;
    case 'coin':openCoin(id);break;
    case 'retry':histories.delete(s.selected);openCoin(s.selected,true);break;
    case 'range':s.range=Number(id);render();break;
    case 'analyze':bulk();break;
    case 'newsmode':s.important=id==='important';render();break;
    case 'add':s.buyCoin=id||null;go('add');break;
    case 'sim':go('sim');break;
    case 'askdelete':s.remove=id;render();break;
    case 'canceldelete':s.remove=null;render();break;
    case 'delete':if(id===s.remove&&storeBuys(s.buys.filter(b=>b.key!==id)))go('portfolio');break;
  }
});
document.addEventListener('input',e=>{
  if(e.target.id==='search'){s.query=e.target.value;document.querySelector('#coin-list').innerHTML=view.coinRows(s);}
});
document.addEventListener('change',e=>{
  if(e.target.id==='sort'){s.sort=e.target.value;render();}
  if(e.target.id==='buy-coin'){
    const coin=s.coins.find(c=>c.id===e.target.value);
    if(coin)e.target.form.elements.price.value=coin.price;
  }
});
document.addEventListener('submit',e=>{
  e.preventDefault();const f=e.target, v=new FormData(f);
  if(f.id==='buy-form'){
    const coin=s.coins.find(c=>c.id===v.get('coin')),qty=Number(v.get('qty')),price=Number(v.get('price')),day=v.get('day');
    if(!coin||!finite(qty*price)||qty<=0||price<=0||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>utcDay(Date.now())){toast('Проверьте количество, цену и дату.');return;}
    const key=Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
    if(storeBuys([...s.buys,{key,coin:coin.id,symbol:coin.symbol,qty,price,day,note:String(v.get('note')).trim()}]))go('portfolio');
  }
  if(f.id==='sim-form'){
    const output=document.querySelector('#simulation');
    try{output.innerHTML=view.simResult(simulate(s.results.get(s.selected).series,s.selected==='bitcoin',s.models.factors,
      v.get('start'),Number(v.get('weekly')),Number(v.get('fear')),Number(v.get('greed'))));}
    catch(err){output.textContent=err.message;}
  }
});
window.advisorBack=()=>{
  if(s.tab==='sim'){go('detail');return true;}
  if(s.tab==='add'){go('portfolio');return true;}
  if(s.tab!=='market'){go('market');return true;}
  if(s.query){s.query='';render();return true;}
  return false;
};
async function start(){
  try{
    const value=JSON.parse(localStorage.getItem('portfolio-v1')||'[]');
    if(!Array.isArray(value))throw Error('portfolio');
    s.buys=value;
  }catch{portfolioLocked=true;toast('Не удалось прочитать сохранённый портфель.');}
  try{s.models=await loadModels();render();await marketRefresh();}
  catch{main.textContent='Не удалось открыть встроенные модели. Повторно откройте приложение.';}
}
start();
