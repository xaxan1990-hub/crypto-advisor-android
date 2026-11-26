import {utcDay,dayMs,context,score,simulate,finite} from './analysis.js';
import {loadModels,request,marketRows,fearMap,fundingMap,history,newsFeeds,recordJournal,journalRows,fxRate,latestRelease} from './data.js';
import {makeKey,legacyToTxs,availableAt,normalizeTxs,nextSeq,parseBackup,buildBackup,mergeTxs} from './portfolio.js';
import * as view from './views.js';

const main=document.querySelector('#main');
const RELEASES='https://github.com/xaxan1990-hub/crypto-advisor-android/releases';
const appVersion=new URLSearchParams(location.search).get('v')||'dev';
const s={tab:'market',selected:null,models:null,coins:[],fear:new Map(),results:new Map(),query:'',sort:'rank',range:365,
  txs:[],buyCoin:null,txType:'buy',remove:null,editTx:null,importTxs:null,importSkipped:0,importCurrency:null,news:null,important:false,journal:null,bulk:false,bulkNote:'',today:utcDay(Date.now()),
  fx:null,fxError:'',currency:'rub',version:appVersion,releasesUrl:RELEASES,release:null,releaseError:'',updateAvailable:false};
let refreshJob,newsJob,journalTicket=0,epoch=0,bulkTicket=0,loading=new Map(),histories=new Map(),fearJob,fxJob;
let marketFromDisk=false,toastTimeout,portfolioLocked=false;

function toast(text){
  const el=document.querySelector('#message');el.textContent=text;
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.textContent='',4500);
}
function readPortfolio(){
  try{
    const v2=JSON.parse(localStorage.getItem('portfolio-v2')||'null');
    if(Array.isArray(v2))return normalizeTxs(v2);
  }catch{portfolioLocked=true;toast('Не удалось прочитать сохранённый портфель.');}
  try{
    const old=JSON.parse(localStorage.getItem('portfolio-v1')||'[]');
    if(Array.isArray(old))return normalizeTxs(legacyToTxs(old,null));
  }catch{portfolioLocked=true;toast('Не удалось прочитать старый портфель.');}
  return [];
}
function storeTxs(next){
  if(portfolioLocked){toast('Исходные записи портфеля не удалось прочитать.');return false;}
  try{
    localStorage.setItem('portfolio-v2',JSON.stringify(next));
    s.txs=next;
    return true;
  }catch{toast('Хранилище заполнено. Изменения не сохранены.');return false;}
}
function upgradeLegacy(){
  if(!s.fx)return;
  let changed=false;
  const next=s.txs.map(tx=>{
    if(tx.rub==null&&finite(tx.priceUsd)&&finite(tx.qty)&&s.fx.rate>0){
      changed=true;
      return {...tx,rub:Number(tx.qty)*Number(tx.priceUsd)*s.fx.rate,legacy:true};
    }
    return tx;
  });
  if(changed){
    s.txs=next;
    if(!portfolioLocked){
      try{localStorage.setItem('portfolio-v2',JSON.stringify(next));}catch{}
      toast('Старый портфель пересчитан в рубли по текущему курсу.');
    }
  }
}
async function loadFx(force=false){
  if(fxJob)return fxJob;
  fxJob=(async()=>{
    try{s.fx=await fxRate(force);s.fxError='';}
    catch{s.fxError='Курс USD/RUB недоступен — стоимость в рублях неполная.';}
    finally{fxJob=null;}
  })();
  return fxJob;
}
function versionParts(v){
  return String(v||'').replace(/^v/,'').split(/[.+-]/).slice(0,3).map(x=>parseInt(x,10)||0);
}
function isNewer(a,b){
  const x=versionParts(a),y=versionParts(b);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];
  return false;
}
function updateApp(){
  if(window.androidUpdater&&typeof window.androidUpdater.checkAndUpdate==='function'){
    toast('Проверяем обновление…');
    window.androidUpdater.checkAndUpdate();
  }else{
    window.location.href=s.releasesUrl;
  }
}
window.updateStatus=(text,kind)=>{
  toast(text);
  const el=document.querySelector('#update-status');
  if(el){
    el.textContent=text;
    el.className='sub '+(kind==='error'?'error':kind==='ok'?'up':'');
  }
};
window.portfolioStatus=(text,kind)=>{
  toast(text);
  if(s.tab==='portfolio'||s.tab==='add')render();
};
window.receivePortfolioImport=text=>{
  const parsed=parseBackup(text);
  if(parsed.error){toast(parsed.error);return;}
  s.importTxs=parsed.txs;
  s.importSkipped=parsed.skipped||0;
  s.importCurrency=parsed.currency;
  s.remove=null;
  go('portfolio');
};
function exportPortfolio(){
  const json=buildBackup(s.txs,s.currency);
  const name='portfolio-'+s.today+'.json';
  if(window.androidPortfolio&&typeof window.androidPortfolio.exportPortfolio==='function'){
    window.androidPortfolio.exportPortfolio(json,name);
    return;
  }
  try{
    const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Файл сформирован.');
  }catch{toast('Экспорт недоступен.');}
}
function importPortfolio(){
  if(window.androidPortfolio&&typeof window.androidPortfolio.importPortfolio==='function'){
    window.androidPortfolio.importPortfolio();
  }else{
    toast('Импорт доступен в приложении.');
  }
}
async function checkUpdateOnStart(){
  try{
    const last=Number(localStorage.getItem('update-check-at')||0);
    if(Date.now()-last<86400000)return;
    const rel=await latestRelease(false);
    s.release=rel;
    if(appVersion!=='dev'&&isNewer(rel.tag,appVersion)){
      s.updateAvailable=true;
      toast('Доступна версия '+rel.tag+'. Откройте «Проверка» → «Обновить приложение».');
      if(s.tab==='research')render();
    }
    try{localStorage.setItem('update-check-at',String(Date.now()));}catch{}
  }catch{}
}
async function checkUpdate(){
  try{
    const rel=await latestRelease(true);
    s.release=rel;
    s.releaseError='';
    s.updateAvailable=appVersion!=='dev'&&isNewer(rel.tag,appVersion);
    toast(s.updateAvailable?'Доступна версия '+rel.tag:'Установлена последняя версия.');
  }catch{
    s.release=null;
    s.updateAvailable=false;
    s.releaseError='GitHub API недоступен. Проверьте соединение и повторите позже.';
    toast('Не удалось проверить обновления через GitHub API.');
  }
  if(s.tab==='research')render();
}
function render(){
  if(!s.models)return;
  s.today=utcDay(Date.now());
  const tab=s.tab==='detail'||s.tab==='sim'?'market':s.tab==='add'?'portfolio':s.tab;
  document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  main.innerHTML=({market:view.market,detail:view.detail,news:view.news,portfolio:view.portfolio,add:view.buyForm,sim:view.simulator,research:view.research})[s.tab](s);
  document.querySelector('#refresh').disabled=!!refreshJob||!!newsJob;
  if(s.tab==='add')updateTxCalc();
}
function updateTxCalc(){
  const f=document.querySelector('#tx-form');
  const out=document.querySelector('#tx-calc');
  if(!f||!out)return;
  const editKey=s.editTx;
  const existing=editKey?s.txs.find(t=>t.key===editKey):null;
  let coin=s.coins.find(c=>c.id===f.elements.coin?.value);
  if(!coin&&existing)coin={id:existing.coin,symbol:existing.symbol};
  const qty=Number(f.elements.qty?.value),rub=Number(f.elements.rub?.value);
  const feeRaw=f.elements.fee?.value,fee=feeRaw===''||feeRaw==null?0:Number(feeRaw);
  const type=f.elements.type?.value==='sell'?'sell':'buy';
  const price=finite(qty)&&qty>0&&finite(rub)&&rub>0?rub/qty:null;
  const usd=price!==null&&s.fx?price/s.fx.rate:null;
  const day=f.elements.day?.value||s.today;
  const held=coin?availableAt(s.txs.filter(t=>t.key!==editKey),coin.id,day):0;
  const parts=[];
  parts.push(price===null?'Укажите количество и сумму в рублях':'Цена за 1: '+price.toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽');
  if(usd!==null)parts.push('≈ $'+usd.toLocaleString('ru-RU',{maximumFractionDigits:2}));
  if(price!==null&&finite(fee)&&fee>0){
    const effective=(type==='sell'?rub-fee:rub+fee)/qty;
    parts.push('с комиссией: '+effective.toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽ за монету');
  }
  if(type==='sell'&&coin)parts.push('Доступно на '+day+': '+held.toLocaleString('ru-RU',{maximumFractionDigits:8})+' '+coin.symbol);
  out.textContent=parts.join(' · ');
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
  if(tab!=='add')s.editTx=null;
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
      if(force){await loadFx(true);upgradeLegacy();}
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

document.addEventListener('click',event=>{
  const el=event.target.closest('button');if(!el||!s.models)return;
  const {tab,act,id}=el.dataset;
  if(tab){go(tab);return;}
  if(el.id==='update'||act==='update-app'){updateApp();return;}
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
    case 'add':s.editTx=null;s.buyCoin=id||null;s.txType='buy';go('add');break;
    case 'askedit':{const tx=s.txs.find(t=>t.key===id);if(tx){s.editTx=tx.key;s.buyCoin=tx.coin;s.txType=tx.type;go('add');}break;}
    case 'canceledit':s.editTx=null;go('portfolio');break;
    case 'txtype':s.txType=id==='sell'?'sell':'buy';render();break;
    case 'currency':s.currency=id==='usd'?'usd':'rub';try{localStorage.setItem('portfolio-currency',s.currency);}catch{}render();break;
    case 'export':exportPortfolio();break;
    case 'import':importPortfolio();break;
    case 'importreplace':
      if(Array.isArray(s.importTxs)&&storeTxs(s.importTxs)){
        s.importTxs=null;s.importSkipped=0;s.importCurrency=null;
        toast('Портфель заменён импортированными операциями.');go('portfolio');
      }
      break;
    case 'importmerge':
      if(Array.isArray(s.importTxs)&&storeTxs(mergeTxs(s.txs,s.importTxs))){
        s.importTxs=null;s.importSkipped=0;s.importCurrency=null;
        toast('Импортированные операции добавлены.');go('portfolio');
      }
      break;
    case 'importcancel':s.importTxs=null;s.importSkipped=0;s.importCurrency=null;render();break;
    case 'checkupdate':checkUpdate();break;
    case 'update-app':updateApp();break;
    case 'sim':go('sim');break;
    case 'askdelete':s.remove=id;render();break;
    case 'canceldelete':s.remove=null;render();break;
    case 'delete':if(id===s.remove&&storeTxs(s.txs.filter(t=>t.key!==id)))go('portfolio');break;
  }
});
document.addEventListener('input',e=>{
  if(e.target.id==='search'){s.query=e.target.value;document.querySelector('#coin-list').innerHTML=view.coinRows(s);}
  if(e.target.closest('#tx-form'))updateTxCalc();
});
document.addEventListener('change',e=>{
  if(e.target.id==='sort'){s.sort=e.target.value;render();}
  if(e.target.id==='tx-coin')updateTxCalc();
});
document.addEventListener('submit',e=>{
  e.preventDefault();const f=e.target, v=new FormData(f);
  if(f.id==='tx-form'){
    const type=v.get('type')==='sell'?'sell':'buy';
    let coin=s.coins.find(c=>c.id===v.get('coin'));
    const editKey=s.editTx;
    const existing=editKey?s.txs.find(t=>t.key===editKey):null;
    if(!coin&&existing&&existing.coin===v.get('coin'))coin={id:existing.coin,symbol:existing.symbol};
    const qty=Number(v.get('qty')),rub=Number(v.get('rub')),day=v.get('day');
    const feeRaw=v.get('fee'),fee=feeRaw===null||feeRaw===''?0:Number(feeRaw);
    if(!coin||!finite(qty)||qty<=0||!finite(rub)||rub<=0||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>utcDay(Date.now())){
      toast('Проверьте монету, количество, сумму и дату.');return;
    }
    if(!finite(fee)||fee<0){
      toast('Комиссия должна быть нулём или положительным числом.');return;
    }
    if(type==='sell'&&fee>rub+1e-9){
      toast('Комиссия не может быть больше суммы продажи.');return;
    }
    const others=editKey?s.txs.filter(t=>t.key!==editKey):s.txs;
    if(type==='sell'){
      const held=availableAt(others,coin.id,day);
      if(qty>held+1e-9){
        toast('На '+day+' доступно '+held.toLocaleString('ru-RU',{maximumFractionDigits:8})+' '+coin.symbol+'.');
        return;
      }
    }
    const base={type,coin:coin.id,symbol:coin.symbol,qty,rub,fee,day,note:String(v.get('note')||'').trim()};
    if(editKey){
      if(!existing){toast('Операция не найдена.');s.editTx=null;render();return;}
      const next=s.txs.map(t=>t.key===editKey?{...t,...base,key:existing.key,seq:existing.seq}:t);
      if(storeTxs(next)){s.editTx=null;toast('Операция изменена.');go('portfolio');}
    }else{
      const tx={key:makeKey(),...base,seq:nextSeq(s.txs)};
      if(storeTxs([...s.txs,tx]))go('portfolio');
    }
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
  s.txs=readPortfolio();
  try{const saved=localStorage.getItem('portfolio-currency');s.currency=saved==='usd'?'usd':'rub';}catch{}
  try{
    s.models=await loadModels();
    render();
    loadFx(false).then(()=>{
      upgradeLegacy();
      if(s.tab==='portfolio'||s.tab==='add')render();
    });
    await marketRefresh();
    checkUpdateOnStart();
  }catch{main.textContent='Не удалось открыть встроенные модели. Повторно откройте приложение.';}
}
start();
