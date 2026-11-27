import {utcDay,dayMs,context,score,simulate,finite} from './analysis.js';
import {loadModels,request,marketRows,fearMap,fundingMap,history,newsFeeds,recordJournal,journalRows,fxRate,fxRateForDay,searchCoins,extraPrices,latestRelease} from './data.js';
import {makeKey,legacyToTxs,availableAt,normalizeTxs,nextSeq,parseBackup,buildBackup,mergeTxs,buildPortfolioSeries} from './portfolio.js';
import {normalizeAlerts} from './alerts.js';
import * as view from './views.js';

const main=document.querySelector('#main');
const RELEASES='https://github.com/xaxan1990-hub/crypto-advisor-android/releases';
const appVersion=new URLSearchParams(location.search).get('v')||'dev';
const s={tab:'market',selected:null,models:null,coins:[],fear:new Map(),results:new Map(),query:'',sort:'rank',range:365,
  txs:[],extras:[],coinUniverse:[],alerts:[],removeAlert:null,notifEnabled:true,portfolioTab:'overview',buyCoin:null,txType:'buy',remove:null,editTx:null,importTxs:null,importSkipped:0,importCurrency:null,coinSearch:'',searchResults:null,searchBusy:false,searchError:'',news:null,important:false,journal:null,bulk:false,bulkNote:'',today:utcDay(Date.now()),
  fx:null,fxError:'',currency:'rub',portfolioRange:365,chartSeries:null,chartBusy:false,chartError:'',chartNote:'',chartKey:'',version:appVersion,releasesUrl:RELEASES,release:null,releaseError:'',updateAvailable:false};
let refreshJob,newsJob,journalTicket=0,epoch=0,bulkTicket=0,loading=new Map(),histories=new Map(),fearJob,fxJob;
let marketFromDisk=false,toastTimeout,portfolioLocked=false,legacyJob=null,extraJob=null,chartTicket=0;

function toastKind(text){
  if(/не удалось|ошибк|недоступ|проверьте|заполнен|не найден|не разреш|слишком|отменена|нельзя/i.test(text))return 'error';
  if(/сохран|добавлен|изменен|удален|обновлен|разреш|включен|готов|заменён|импортирован/i.test(text))return 'ok';
  return 'info';
}
function hideToast(){
  const el=document.querySelector('#message');
  if(el&&el.classList.contains('show'))el.classList.remove('show');
}
function toast(text,kind,actionLabel,action){
  const el=document.querySelector('#message');
  if(!el)return;
  clearTimeout(toastTimeout);
  el.className='show '+(kind||toastKind(text));
  el.replaceChildren();
  const label=document.createElement('span');
  label.textContent=text;
  el.append(label);
  if(actionLabel&&typeof action==='function'){
    const button=document.createElement('button');
    button.type='button';button.textContent=actionLabel;
    button.addEventListener('click',()=>{hideToast();action();},{once:true});
    el.append(button);
  }
  toastTimeout=setTimeout(hideToast,actionLabel?7000:4500);
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
    s.chartKey='';s.chartSeries=null;s.chartError='';
    return true;
  }catch{toast('Хранилище заполнено. Изменения не сохранены.');return false;}
}
function readExtras(){
  try{
    const list=JSON.parse(localStorage.getItem('portfolio-coins')||'[]');
    if(!Array.isArray(list))return [];
    return list.filter(c=>c&&typeof c.id==='string'&&c.id).map(c=>({
      id:c.id,
      name:String(c.name||c.symbol||c.id),
      symbol:String(c.symbol||c.id).toUpperCase(),
      price:finite(Number(c.price))&&Number(c.price)>0?Number(c.price):null,
      at:Number(c.at)||0,
    }));
  }catch{return [];}
}
function readAlerts(){
  try{
    const raw=window.androidAlerts?.load?.();
    if(typeof raw==='string')return normalizeAlerts(JSON.parse(raw));
  }catch{}
  try{return normalizeAlerts(JSON.parse(localStorage.getItem('alerts-v1')||'[]'));}
  catch{return [];}
}
function notificationsEnabled(){
  try{
    if(window.androidAlerts?.enabled)return !!window.androidAlerts.enabled();
  }catch{}
  return true;
}
function saveAlerts(){
  try{localStorage.setItem('alerts-v1',JSON.stringify(s.alerts));}catch{}
  try{window.androidAlerts?.save?.(JSON.stringify(s.alerts));}catch{}
  s.notifEnabled=notificationsEnabled();
}
function refreshAlerts(){
  const next=readAlerts();
  s.notifEnabled=notificationsEnabled();
  if(JSON.stringify(next)!==JSON.stringify(s.alerts)){
    s.alerts=next;
    if(s.tab==='portfolio')render();
  }
}
window.alertPermission=granted=>{
  s.notifEnabled=!!granted;
  toast(granted?'Уведомления разрешены.':'Уведомления не разрешены.');
  if(s.tab==='portfolio')render();
};
function saveExtras(){
  try{localStorage.setItem('portfolio-coins',JSON.stringify(s.extras));}catch{}
}
function rebuildUniverse(){
  s.coinUniverse=[...s.coins,...s.extras.filter(e=>!s.coins.some(c=>c.id===e.id))];
}
function addExtra(coin){
  if(!coin?.id)return;
  const entry={
    id:String(coin.id),
    name:String(coin.name||coin.symbol||coin.id),
    symbol:String(coin.symbol||coin.id).toUpperCase(),
    price:finite(Number(coin.price))&&Number(coin.price)>0?Number(coin.price):null,
    at:Number(coin.at)||0,
  };
  const index=s.extras.findIndex(x=>x.id===entry.id);
  if(index>=0)s.extras[index]={...s.extras[index],...entry};
  else s.extras.push(entry);
  saveExtras();rebuildUniverse();
}
function syncExtras(){
  const known=new Set([...s.coins,...s.extras].map(c=>c.id));
  let changed=false;
  for(const tx of s.txs){
    if(!tx.coin||known.has(tx.coin))continue;
    known.add(tx.coin);
    const symbol=String(tx.symbol||tx.coin).toUpperCase();
    s.extras.push({id:tx.coin,name:symbol,symbol,price:null,at:0});
    changed=true;
  }
  if(changed){saveExtras();rebuildUniverse();}
}
async function refreshExtraPrices(){
  if(extraJob)return extraJob;
  const ids=s.extras.filter(e=>e.id&&!s.coins.some(c=>c.id===e.id)).map(e=>e.id);
  if(!ids.length){rebuildUniverse();return;}
  extraJob=(async()=>{
    try{
      const prices=await extraPrices(ids);
      let changed=false;
      s.extras=s.extras.map(e=>{
        const found=prices.get(e.id);
        if(!found)return e;
        changed=true;
        return {...e,price:found.price,at:found.at};
      });
      if(changed){
        saveExtras();rebuildUniverse();
        s.chartKey='';
        if(s.tab==='portfolio'||s.tab==='add')render();
      }
    }catch{}
    finally{extraJob=null;}
  })();
  return extraJob;
}
function chartSignature(){
  return JSON.stringify([
    s.portfolioRange,
    Math.round((s.fx?.rate||0)*1e6),
    s.txs.map(t=>[t.key,t.day,t.type,t.coin,t.qty,t.rub,t.fee]),
    [...s.coins,...s.extras].map(c=>[c.id,Math.round((c.price||0)*1e8)]),
  ]);
}
async function loadPortfolioChart(){
  const ticket=++chartTicket;
  if(!s.txs.length||!s.fx){
    s.chartBusy=false;
    s.chartSeries=null;
    s.chartError=s.txs.length?'Курс USD/RUB недоступен — график в рублях не построить.':'';
    s.chartNote='';
    if(s.tab==='portfolio')render();
    return;
  }
  const signature=chartSignature();
  if(s.chartKey===signature&&s.chartSeries)return;
  s.chartBusy=true;s.chartError='';s.chartNote='';
  if(s.tab==='portfolio')render();
  try{
    rebuildUniverse();
    const ids=[...new Set(s.txs.map(t=>t.coin))];
    const skipped=Math.max(0,ids.length-15);
    const needed=ids.slice(0,15).map(id=>s.coinUniverse.find(c=>c.id===id)||{id,symbol:id,price:null});
    const histories=new Map();
    for(let i=0;i<needed.length;i+=3){
      await Promise.all(needed.slice(i,i+3).map(async coin=>{
        try{histories.set(coin.id,await getHistory(coin,false));}catch{}
      }));
    }
    if(ticket!==chartTicket)return;
    const chart=buildPortfolioSeries(s.txs,needed,histories,s.fx.rate,s.portfolioRange,s.today);
    s.chartSeries=chart;
    s.chartKey=signature;
    s.chartNote=skipped?'Для графика учтены первые 15 монет из '+ids.length+'.':'';
  }catch(error){
    if(ticket===chartTicket)s.chartError='Не удалось построить график: '+(error.message||'нет истории цен');
  }finally{
    if(ticket===chartTicket){
      s.chartBusy=false;
      if(s.tab==='portfolio')render();
    }
  }
}
function upgradeLegacy(){
  if(legacyJob)return legacyJob;
  legacyJob=(async()=>{
    const original=s.txs;
    const pending=original.filter(tx=>tx.rub==null&&finite(tx.priceUsd)&&finite(tx.qty)&&tx.qty>0);
    if(!pending.length)return;
    const rates=new Map();
    const days=[...new Set(pending.map(tx=>tx.day))];
    for(let i=0;i<days.length;i+=4){
      await Promise.all(days.slice(i,i+4).map(async day=>{
        try{rates.set(day,await fxRateForDay(day));}catch{}
      }));
    }
    let changed=false,approx=0;
    const next=original.map(tx=>{
      if(tx.rub!=null||!finite(tx.priceUsd)||!finite(tx.qty)||tx.qty<=0)return tx;
      const found=rates.get(tx.day);
      if(found){
        changed=true;
        return {...tx,rub:Number(tx.qty)*Number(tx.priceUsd)*found.rate,legacy:true,rateDate:found.date,fxApprox:false};
      }
      if(s.fx&&finite(s.fx.rate)&&s.fx.rate>0){
        changed=true;approx++;
        return {...tx,rub:Number(tx.qty)*Number(tx.priceUsd)*s.fx.rate,legacy:true,fxApprox:true};
      }
      return tx;
    });
    if(!changed)return;
    if(s.txs!==original)return;
    s.txs=next;
    s.chartKey='';s.chartSeries=null;
    if(!portfolioLocked){
      try{localStorage.setItem('portfolio-v2',JSON.stringify(next));}catch{}
    }
    toast(approx
      ? 'Старый портфель пересчитан: '+approx+' операций по текущему курсу, остальные — по курсу ЦБ на дату.'
      : 'Старый портфель пересчитан по курсу ЦБ на дату операции.');
    if(s.tab==='portfolio'||s.tab==='add')render();
  })().finally(()=>{legacyJob=null;});
  return legacyJob;
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
  syncExtras();
  rebuildUniverse();
  s.today=utcDay(Date.now());
  const tab=s.tab==='detail'||s.tab==='sim'?'market':s.tab==='add'?'portfolio':s.tab;
  document.querySelectorAll('nav button').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const offline=s.stale&&['market','portfolio'].includes(s.tab)?'<div class="offline">Нет свежих данных — показаны сохранённые котировки.</div>':'';
  main.innerHTML=view.updateBanner(s)+offline+({market:view.market,detail:view.detail,news:view.news,portfolio:view.portfolio,add:view.buyForm,sim:view.simulator,research:view.research})[s.tab](s);
  document.querySelector('#refresh').disabled=!!refreshJob||!!newsJob;
  if(s.tab==='add')updateTxCalc();
  updateAlertSuffix();
}
function updateAlertSuffix(){
  const form=document.querySelector('#alert-form');
  const suffix=document.querySelector('#alert-suffix');
  if(form&&suffix)suffix.textContent=form.elements.currency?.value==='usd'?'$':'₽';
}
function num(value){
  const text=String(value??'').replace(/\s+/g,'').replace(',','.');
  const n=Number(text);
  return finite(n)?n:NaN;
}
function setFormError(id,text){
  const el=document.querySelector('#'+id);
  if(el){el.textContent=text;el.scrollIntoView({block:'nearest'});}
  else toast(text);
}
function clearFormError(id){
  const el=document.querySelector('#'+id);
  if(el)el.textContent='';
}
function captureDraft(){
  const f=document.querySelector('#tx-form');
  if(!f)return;
  s.txDraft={coin:f.elements.coin?.value||'',qty:f.elements.qty?.value||'',rub:f.elements.rub?.value||'',
    fee:f.elements.fee?.value||'',day:f.elements.day?.value||s.today,note:f.elements.note?.value||''};
}
function updateTxCalc(){
  const f=document.querySelector('#tx-form');
  const out=document.querySelector('#tx-calc');
  if(!f||!out)return;
  const editKey=s.editTx;
  const existing=editKey?s.txs.find(t=>t.key===editKey):null;
  let coin=(s.coinUniverse||s.coins).find(c=>c.id===f.elements.coin?.value);
  if(!coin&&existing)coin={id:existing.coin,symbol:existing.symbol};
  const qty=num(f.elements.qty?.value),rub=num(f.elements.rub?.value);
  const feeRaw=f.elements.fee?.value,fee=feeRaw===''||feeRaw==null?0:num(feeRaw);
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
  if(tab!=='add'){s.editTx=null;s.txDraft=null;}
  s.tab=tab;s.remove=null;window.scrollTo(0,0);render();
  if(tab==='portfolio'){refreshAlerts();loadPortfolioChart();if(s.extras.length)refreshExtraPrices();}
  if(tab==='news'&&!s.news)loadNews(false);
  if(tab==='research')readJournal();
}
async function runCoinSearch(){
  const input=document.querySelector('#coin-search');
  const query=String(input?.value??s.coinSearch??'').trim();
  s.coinSearch=query;
  if(query.length<2){
    s.searchBusy=false;s.searchResults=null;
    s.searchError='Введите хотя бы 2 символа названия или тикера.';
    renderCoinSearchResults();return;
  }
  s.searchBusy=true;s.searchResults=null;s.searchError='';
  renderCoinSearchResults();
  try{
    s.searchResults=await searchCoins(query);
    s.searchError=s.searchResults.length?'':'Ничего не найдено. Проверьте название или тикер.';
  }catch{
    s.searchResults=[];
    s.searchError='Поиск CoinGecko недоступен. Проверьте соединение и повторите.';
  }
  s.searchBusy=false;
  renderCoinSearchResults();
}
function renderCoinSearchResults(){
  const el=document.querySelector('#coin-search-results');
  if(el)el.innerHTML=view.coinSearchResults(s);
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
      if(force){await loadFx(true);await upgradeLegacy();}
      const pack=await request('market','',force),coins=marketRows(pack.data,s.models.config);
      if(!coins.length)throw Error('Пустой рейтинг');
      const wanted=s.selected;
      epoch++;bulkTicket++;s.bulk=false;s.bulkNote='';loading=new Map();histories=new Map();
      s.coins=coins;s.results=new Map();s.marketTime=pack.at;s.stale=!!pack.stale;marketFromDisk=!!pack.stale;s.marketError='';
      s.chartKey='';
      syncExtras();rebuildUniverse();
      if(!coins.some(c=>c.id===wanted)&&['detail','sim'].includes(s.tab))s.tab='market';
      s.fear=new Map();
      fearJob=request('fear','',force).then(x=>({map:fearMap(x.data.data),stale:!!x.stale})).catch(()=>null);
      const current=epoch;
      fearJob.then(f=>{if(f&&epoch===current){s.fear=f.map;safeMarketRender();}});
      if(s.tab!=='add')render();
      if(s.tab==='portfolio')loadPortfolioChart();
      if(s.extras.length)refreshExtraPrices();
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
    if(['market','detail','portfolio'].includes(s.tab))render();
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
    case 'add':s.editTx=null;s.txDraft=null;s.buyCoin=id||null;s.txType='buy';s.searchResults=null;s.searchError='';s.coinSearch='';go('add');break;
    case 'addsell':s.editTx=null;s.txDraft=null;s.buyCoin=id||null;s.txType='sell';s.searchResults=null;s.searchError='';s.coinSearch='';go('add');break;
    case 'ptab':s.portfolioTab=['overview','positions','history','alerts'].includes(id)?id:'overview';try{localStorage.setItem('portfolio-tab',s.portfolioTab);}catch{}s.removeAlert=null;s.remove=null;window.scrollTo(0,0);render();if(s.portfolioTab==='alerts')refreshAlerts();break;
    case 'sellpct':{
      if(!id)break;
      const f=document.querySelector('#tx-form');
      if(!f)break;
      const coin=(s.coinUniverse||s.coins).find(c=>c.id===f.elements.coin?.value);
      const day=f.elements.day?.value||s.today;
      if(!coin)break;
      const held=availableAt(s.txs.filter(t=>t.key!==s.editTx),coin.id,day);
      const qty=held*(Number(id)/100);
      f.elements.qty.value=qty>0?String(Number(qty.toFixed(10))):'';
      updateTxCalc();
      break;
    }
    case 'askedit':{const tx=s.txs.find(t=>t.key===id);if(tx){s.editTx=tx.key;s.buyCoin=tx.coin;s.txType=tx.type;go('add');}break;}
    case 'canceledit':s.editTx=null;go('portfolio');break;
    case 'coinsearch':runCoinSearch();break;
    case 'pickcoin':{
      const coin=s.searchResults?.find(c=>c.id===id);
      if(coin){
        captureDraft();
        if(!s.coins.some(c=>c.id===coin.id))addExtra(coin);
        s.buyCoin=coin.id;s.txDraft={...(s.txDraft||{}),coin:coin.id};
        s.searchResults=null;s.searchError='';s.coinSearch=coin.symbol;
        render();
      }
      break;
    }
    case 'txtype':captureDraft();s.txType=id==='sell'?'sell':'buy';render();break;
    case 'currency':s.currency=id==='usd'?'usd':'rub';try{localStorage.setItem('portfolio-currency',s.currency);}catch{}render();break;
    case 'chartrange':s.portfolioRange=Number(id)||365;s.chartKey='';render();loadPortfolioChart();break;
    case 'loadchart':s.chartKey='';loadPortfolioChart();break;
    case 'export':exportPortfolio();break;
    case 'import':importPortfolio();break;
    case 'importreplace':
      if(Array.isArray(s.importTxs)&&storeTxs(s.importTxs)){
        s.importTxs=null;s.importSkipped=0;s.importCurrency=null;
        syncExtras();rebuildUniverse();refreshExtraPrices();
        toast('Портфель заменён импортированными операциями.');go('portfolio');
      }
      break;
    case 'importmerge':
      if(Array.isArray(s.importTxs)&&storeTxs(mergeTxs(s.txs,s.importTxs))){
        s.importTxs=null;s.importSkipped=0;s.importCurrency=null;
        syncExtras();rebuildUniverse();refreshExtraPrices();
        toast('Импортированные операции добавлены.');go('portfolio');
      }
      break;
    case 'importcancel':s.importTxs=null;s.importSkipped=0;s.importCurrency=null;render();break;
    case 'notifperm':try{window.androidAlerts?.requestPermission?.();}catch{}break;
    case 'notifsettings':try{window.androidAlerts?.settings?.();}catch{}break;
    case 'alertnow':
      if(!s.notifEnabled){toast('Сначала разрешите уведомления.');break;}
      try{window.androidAlerts?.checkNow?.();toast('Проверка запущена. Если цель достигнута, придёт уведомление.');}catch{toast('Проверка недоступна.');}
      break;
    case 'realert':s.alerts=s.alerts.map(a=>a.key===id?{...a,enabled:true,triggeredAt:null}:a);saveAlerts();render();toast('Уведомление снова включено.');break;
    case 'askdelalert':s.removeAlert=id;render();break;
    case 'cancelalert':s.removeAlert=null;render();break;
    case 'delalert':
      if(id===s.removeAlert){
        s.alerts=s.alerts.filter(a=>a.key!==id);s.removeAlert=null;saveAlerts();render();
      }
      break;
    case 'checkupdate':checkUpdate();break;
    case 'update-app':updateApp();break;
    case 'sim':go('sim');break;
    case 'askdelete':s.remove=id;render();break;
    case 'canceldelete':s.remove=null;render();break;
    case 'delete':{
      if(id!==s.remove)break;
      const removed=s.txs.find(t=>t.key===id);
      if(!removed)break;
      if(storeTxs(s.txs.filter(t=>t.key!==id))){
        s.remove=null;
        render();
        toast('Операция удалена.','ok','Отменить',()=>{
          if(!s.txs.some(t=>t.key===removed.key)&&storeTxs([...s.txs,removed])){
            s.portfolioTab='history';render();
          }
        });
      }
      break;
    }
  }
});
document.addEventListener('input',e=>{
  if(e.target.id==='search'){s.query=e.target.value;document.querySelector('#coin-list').innerHTML=view.coinRows(s);}
  if(e.target.id==='coin-search')s.coinSearch=e.target.value;
  if(e.target.closest('#tx-form')){updateTxCalc();clearFormError('tx-error');}
  if(e.target.closest('#alert-form'))clearFormError('alert-error');
  if(e.target.closest('#sim-form'))clearFormError('sim-error');
});
document.addEventListener('change',e=>{
  if(e.target.id==='sort'){s.sort=e.target.value;render();}
  if(e.target.id==='tx-coin')updateTxCalc();
  if(e.target.name==='currency'&&e.target.closest('#alert-form'))updateAlertSuffix();
});
document.addEventListener('submit',e=>{
  e.preventDefault();const f=e.target, v=new FormData(f);
  if(f.id==='tx-form'){
    const type=v.get('type')==='sell'?'sell':'buy';
    let coin=(s.coinUniverse||s.coins).find(c=>c.id===v.get('coin'));
    const editKey=s.editTx;
    const existing=editKey?s.txs.find(t=>t.key===editKey):null;
    if(!coin&&existing&&existing.coin===v.get('coin'))coin={id:existing.coin,symbol:existing.symbol};
    const qty=num(v.get('qty')),rub=num(v.get('rub')),day=v.get('day');
    const feeRaw=v.get('fee'),fee=feeRaw===null||feeRaw===''?0:num(feeRaw);
    if(!coin||!finite(qty)||qty<=0||!finite(rub)||rub<=0||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day>utcDay(Date.now())){
      setFormError('tx-error','Проверьте монету, количество, сумму и дату.');return;
    }
    if(!finite(fee)||fee<0){
      setFormError('tx-error','Комиссия должна быть нулём или положительным числом.');return;
    }
    if(type==='sell'&&fee>rub+1e-9){
      setFormError('tx-error','Комиссия не может быть больше суммы продажи.');return;
    }
    const others=editKey?s.txs.filter(t=>t.key!==editKey):s.txs;
    if(type==='sell'){
      const held=availableAt(others,coin.id,day);
      if(qty>held+1e-9){
        setFormError('tx-error','На '+view.dateText(day)+' доступно '+held.toLocaleString('ru-RU',{maximumFractionDigits:8})+' '+coin.symbol+'.');
        return;
      }
    }
    const base={type,coin:coin.id,symbol:coin.symbol,qty,rub,fee,day,note:String(v.get('note')||'').trim(),legacy:false,rateDate:null,fxApprox:false};
    if(editKey){
      if(!existing){setFormError('tx-error','Операция не найдена.');s.editTx=null;return;}
      const next=s.txs.map(t=>t.key===editKey?{...t,...base,key:existing.key,seq:existing.seq}:t);
      if(storeTxs(next)){s.editTx=null;s.txDraft=null;s.portfolioTab='history';try{localStorage.setItem('portfolio-tab','history');}catch{}toast('Операция изменена.','ok');go('portfolio');}
    }else{
      const tx={key:makeKey(),...base,seq:nextSeq(s.txs)};
      if(storeTxs([...s.txs,tx])){s.txDraft=null;s.portfolioTab='history';try{localStorage.setItem('portfolio-tab','history');}catch{}toast('Операция добавлена.','ok');go('portfolio');}
    }
  }
  if(f.id==='alert-form'){
    const coin=(s.coinUniverse||s.coins).find(c=>c.id===v.get('coin'));
    const target=num(v.get('target'));
    const currency=v.get('currency')==='usd'?'usd':'rub';
    if(!coin||!finite(target)||target<=0){
      setFormError('alert-error','Проверьте монету и целевую цену.');return;
    }
    let targetUsd,targetRub;
    if(currency==='rub'){
      if(!s.fx||!finite(s.fx.rate)||s.fx.rate<=0){setFormError('alert-error','Курс USD/RUB недоступен — укажите цель в долларах.');return;}
      targetRub=target;targetUsd=target/s.fx.rate;
    }else{
      targetUsd=target;
      targetRub=s.fx&&finite(s.fx.rate)?target*s.fx.rate:null;
    }
    const label=currency==='rub'
      ?target.toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽'
      :'$'+target.toLocaleString('ru-RU',{maximumFractionDigits:2});
    const alert={key:makeKey(),coin:coin.id,symbol:coin.symbol,above:v.get('dir')!=='below',
      targetUsd,targetRub,currency,enabled:true,triggeredAt:null,createdAt:Date.now(),targetLabel:label};
    s.alerts=[...s.alerts,alert];
    saveAlerts();render();
    toast('Уведомление сохранено.'+(s.notifEnabled?'':' Разрешите уведомления.'),'ok');
  }
  if(f.id==='sim-form'){
    const output=document.querySelector('#simulation');
    try{output.innerHTML=view.simResult(simulate(s.results.get(s.selected).series,s.selected==='bitcoin',s.models.factors,
      v.get('start'),num(v.get('weekly')),num(v.get('fear')),num(v.get('greed'))));}
    catch(err){setFormError('sim-error',err.message);}
  }
});
function showChartTip(event){
  const plot=event.target.closest?.('.chart-plot');
  if(!plot)return;
  const svg=plot.querySelector('svg[data-points]');
  if(!svg)return;
  let points;
  try{points=JSON.parse(svg.dataset.points||'[]');}catch{return;}
  if(!points.length)return;
  const rect=svg.getBoundingClientRect();
  const ratio=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));
  const index=Math.min(points.length-1,Math.round(ratio*(points.length-1)));
  const tip=plot.querySelector('.chart-tip');
  tip.textContent=points[index];
  tip.style.display='block';
  tip.style.top='8px';
  tip.style.left=Math.max(4,Math.min(rect.width-170,ratio*rect.width-80))+'px';
}
function hideChartTips(){
  document.querySelectorAll('.chart-tip').forEach(el=>{el.style.display='none';});
}
document.addEventListener('pointerdown',showChartTip);
document.addEventListener('pointermove',e=>{if(e.pointerType==='mouse')showChartTip(e);});
document.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse')setTimeout(hideChartTips,2600);});
document.addEventListener('scroll',hideChartTips,{passive:true});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)return;
  s.notifEnabled=notificationsEnabled();
  if(s.tab==='portfolio')refreshAlerts();
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
  s.extras=readExtras();
  s.alerts=readAlerts();
  s.notifEnabled=notificationsEnabled();
  syncExtras();
  rebuildUniverse();
  try{const saved=localStorage.getItem('portfolio-currency');s.currency=saved==='usd'?'usd':'rub';const tab=localStorage.getItem('portfolio-tab');if(['overview','positions','history','alerts'].includes(tab))s.portfolioTab=tab;}catch{}
  try{
    s.models=await loadModels();
    render();
    loadFx(false).then(async()=>{
      await upgradeLegacy();
      if(s.tab==='portfolio'||s.tab==='add')render();
      if(s.tab==='portfolio')loadPortfolioChart();
    });
    await marketRefresh();
    checkUpdateOnStart();
  }catch{main.textContent='Не удалось открыть встроенные модели. Повторно откройте приложение.';}
}
start();
