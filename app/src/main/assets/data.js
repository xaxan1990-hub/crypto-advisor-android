import {utcDay,dayMs,finite,indicators} from './analysis.js';

async function json(path){
  const res=await fetch(path,{cache:'no-store'});
  if(!res.ok)throw Error('Источник недоступен ('+res.status+').');
  return res.json();
}
export async function loadModels(){
  const names=['config','factors','report','short','medium','long'];
  return Object.fromEntries(await Promise.all(names.map(async key=>[key,await json('/models/'+key+'.json')])));
}
export const request=(name,id='',refresh=false)=>json('/data/'+name+'?id='+encodeURIComponent(id)+'&refresh='+(refresh?'1':'0'));

export function marketRows(raw,config){
  const exclude=new Set(config.EXCLUDE_SYMBOLS);
  const words=[...config.EXCLUDE_NAME_WORDS,' fund','treasury','tokenized',' eur','euro','gold'];
  return raw.filter(c=>{
    const name=(c.name||'').toLowerCase(),symbol=(c.symbol||'').toLowerCase();
    const d=Math.abs(c.price_change_percentage_24h||0),w=Math.abs(c.price_change_percentage_7d_in_currency||0),m=Math.abs(c.price_change_percentage_30d_in_currency||0);
    return c.id&&symbol&&Number.isFinite(c.current_price)&&c.current_price>0&&!exclude.has(symbol)&&!words.some(x=>name.includes(x))
      &&!(d<.6&&w<1.5&&m<3)&&!(c.current_price>.97&&c.current_price<1.03&&d<1&&symbol.includes('usd'));
  }).slice(0,50).map((c,i)=>({id:c.id,name:c.name,symbol:c.symbol.toUpperCase(),rank:i+1,price:c.current_price,
    cap:c.market_cap,p24:c.price_change_percentage_24h_in_currency??c.price_change_percentage_24h,
    p7:c.price_change_percentage_7d_in_currency,p30:c.price_change_percentage_30d_in_currency,at:Date.parse(c.last_updated)}));
}
export function fearMap(data){
  const out=new Map();
  for(const r of data){const v=Number(r.value),time=Number(r.timestamp)*1000;
    if(r.value!=null&&v>=0&&v<=100&&finite(time))out.set(utcDay(time),v);}
  return out;
}
export function fundingMap(data){
  const sums=new Map();
  for(const x of data){const rate=Number(x.fundingRate),t=Number(x.fundingTime);
    if(!finite(rate)||!finite(t))continue;
    const key=utcDay(t),a=sums.get(key)||[0,0];a[0]+=rate;a[1]++;sums.set(key,a);}
  return new Map(Array.from(sums,([d,[sum,n]])=>[d,sum/n]));
}
function cleanCandles(candles,today){
  const byDay=new Map();
  for(const r of candles)if(r.day<today&&r.close>0&&finite(r.close))byDay.set(r.day,r);
  return [...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
export async function history(coin,refresh){
  const today=utcDay(Date.now());
  try{
    const pack=await request('candles',coin.symbol,refresh);
    const raw=pack.data, last=raw[raw.length-1];
    if(!last || Math.abs(Number(last[4])/coin.price-1)>=.08 || Math.abs(Number(last[0])-coin.at)>2*dayMs)throw Error('Пара не совпадает');
    const candles=cleanCandles(raw.map(k=>({day:utcDay(+k[0]),close:+k[4],volume:+k[7]})),today);
    if(candles.length<15)throw Error('Мало свечей');
    return {rows:indicators(candles),source:'Binance',stale:!!pack.stale};
  }catch{
    const pack=await request('chart',coin.id,refresh),raw=pack.data;
    const volume=new Map(raw.total_volumes.map(([t,v])=>[utcDay(t),v]));
    const candles=cleanCandles(raw.prices.map(([t,p])=>({day:utcDay(t),close:p,volume:volume.get(utcDay(t))??0})),today);
    if(candles.length<15)throw Error('Для оценки нужно 15 дневных цен.');
    return {rows:indicators(candles),source:'CoinGecko',stale:!!pack.stale};
  }
}

export async function newsFeeds(config,refresh){
  const events=config.EVENTS.map(([pattern,label])=>[new RegExp(pattern,"i"),label]);
  const packs=await Promise.allSettled(Object.keys(config.NEWS_FEEDS).map(async source=>{
    const pack=await request('news',source,refresh);
    const xml=new DOMParser().parseFromString(pack.data,'text/xml');
    if(xml.querySelector('parsererror'))throw Error('Некорректный RSS');
    const items=[];
    for(const node of Array.from(xml.querySelectorAll('item,entry')).slice(0,20)){
      const title=node.querySelector('title')?.textContent?.trim();
      const linkNode=node.querySelector('link'),link=linkNode?.getAttribute('href')||linkNode?.textContent?.trim();
      const stamp=node.querySelector('pubDate,published,updated')?.textContent;
      if(!title||!link)continue;
      try{if(new URL(link).protocol!=='https:')continue;}catch{continue;}
      items.push({title,link,source,time:Date.parse(stamp)||0,events:events.filter(([rx])=>rx.test(title)).map(([,label])=>label)});
    }
    return {items,stale:!!pack.stale};
  }));
  const valid=packs.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const unique=new Map();
  for(const feed of valid)for(const item of feed.items)unique.set(item.link,item);
  return {items:[...unique.values()].sort((a,b)=>b.time-a.time),sources:valid.length,total:packs.length,stale:valid.some(x=>x.stale)};
}

let database;
function openJournal(){
  if(!database)database=new Promise((resolve,reject)=>{
    const req=indexedDB.open('crypto-advisor',1);
    req.onupgradeneeded=()=>{const s=req.result.createObjectStore('journal',{keyPath:'key'});s.createIndex('coin','id');};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>{database=null;reject(req.error);};
  });
  return database;
}
export async function recordJournal(coin,cards,rows,canRecord){
  const db=await openJournal();
  const today=utcDay(Date.now()),prices=new Map(rows.map(r=>[r.day,r.close]));
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('journal','readwrite'),store=tx.objectStore('journal');
    const req=store.index('coin').getAll(coin.id);
    req.onsuccess=()=>{
      const existing=new Set(req.result.map(x=>x.key));
      for(const r of req.result){
        if(r.ret!=null||r.due>=today||!prices.has(r.due))continue;
        r.ret=prices.get(r.due)/r.price-1;store.put(r);
      }
      if(!canRecord)return;
      for(const c of cards){
        const key=[today,coin.id,c.key].join('/');
        if(existing.has(key))continue;
        const days={short:7,medium:30,long:180}[c.key];
        store.add({key,id:coin.id,symbol:coin.symbol,day:today,due:utcDay(Date.parse(today)+days*dayMs),
          horizon:c.key,total:c.total,price:coin.price,ret:null});
      }
    };
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });
}
export async function fxRate(refresh=false){
  try{
    const pack=await request('fx','',refresh);
    const usd=pack.data?.Valute?.USD;
    const nominal=Number(usd?.Nominal||1);
    const rate=Number(usd?.Value)/nominal;
    if(!finite(rate)||rate<=0)throw Error('Некорректный курс ЦБ');
    return {rate,date:String(pack.data?.Date||'').slice(0,10),source:'ЦБ РФ',stale:!!pack.stale};
  }catch(e){
    const pack=await request('fx_usdt','',refresh);
    const rate=Number(pack.data?.tether?.rub);
    if(!finite(rate)||rate<=0)throw e;
    return {rate,date:'',source:'USDT/RUB',stale:!!pack.stale};
  }
}

export async function latestRelease(refresh=false){
  const pack=await request('release','',refresh);
  const data=Array.isArray(pack.data)?pack.data[0]:pack.data;
  if(!data?.tag_name)throw Error('Релизы не найдены');
  return {tag:String(data.tag_name),url:String(data.html_url||''),stale:!!pack.stale};
}

export async function journalRows(){
  const db=await openJournal();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('journal').objectStore('journal').getAll();
    req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.day.localeCompare(a.day)||a.symbol.localeCompare(b.symbol)));
    req.onerror=()=>reject(req.error);
  });
}
