import {finite,horizons} from './analysis.js';
import {summarize,availableAt,txRub,txFee,sortTxs} from './portfolio.js';

export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const fmt=(n,d=2)=>finite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
const MONTHS=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_FULL=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export const dateText=day=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'')))return String(day||'—');
  const d=new Date(day+'T00:00:00Z');
  return d.getUTCDate()+' '+MONTHS[d.getUTCMonth()]+' '+d.getUTCFullYear();
};
export const monthText=day=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'')))return String(day||'');
  const d=new Date(day+'T00:00:00Z');
  return MONTHS_FULL[d.getUTCMonth()]+' '+d.getUTCFullYear();
};
const empty=(icon,title,text,action='')=>`<div class="empty"><div class="empty-icon" aria-hidden="true">${icon}</div><strong>${esc(title)}</strong><p>${esc(text)}</p>${action}</div>`;
export const money=n=>finite(n)?'$'+fmt(n,n>=1?2:n>=.001?5:9):'—';
const sign=(v,d=1)=>finite(v)?(v>0?'+':'')+fmt(v,d):'—';
const color=v=>v>0?'up':v<0?'down':'';
const pct=v=>finite(v)?sign(v)+'%':'—';
export const when=t=>finite(t)&&t>0?new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const act=(a,label,id='',cls='')=>`<button type="button" class="${cls}" data-act="${a}" data-id="${esc(id)}">${esc(label)}</button>`;
const panel=s=>`<div class="panel">${s}</div>`;
const metric=(name,value,cls='')=>`<div class="metric"><small>${esc(name)}</small><strong class="mono ${cls}">${esc(value)}</strong></div>`;
const header=(title,sub='')=>`<h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>`;
const opts=(list,current)=>list.map(([id,label])=>`<option value="${esc(id)}" ${id===current?'selected':''}>${esc(label)}</option>`).join('');
const note=s=>`<p class="sub">${esc(s)}</p>`;
export function updateBanner(s){
  if(!s.updateAvailable||!s.release)return '';
  return `<button type="button" class="update-banner" data-act="update-app"><span><strong>Доступна версия ${esc(s.release.tag)}</strong><small>Нажмите, чтобы скачать и установить</small></span><span class="badge">Обновить</span></button>`;
}

export function chart(rows){
  if(rows.length<2)return note('Недостаточно точек для графика.');
  let data=rows.map(r=>({
    ...r,
    open:finite(r.open)?r.open:r.close,
    high:finite(r.high)&&r.high>0?r.high:r.close,
    low:finite(r.low)&&r.low>0?r.low:r.close,
  }));
  if(data.length>110){
    const size=Math.ceil(data.length/110),grouped=[];
    for(let i=0;i<data.length;i+=size){
      const group=data.slice(i,i+size),first=group[0],last=group.at(-1);
      const high=Math.max(...group.map(r=>finite(r.high)&&r.high>0?r.high:r.close));
      const low=Math.min(...group.map(r=>finite(r.low)&&r.low>0?r.low:r.close));
      grouped.push({day:last.day,open:first.open??first.close,high,low,close:last.close,ma50:last.ma50,ma200:last.ma200});
    }
    data=grouped;
  }
  const vals=data.flatMap(r=>[r.high,r.low,r.ma50,r.ma200]).filter(finite);
  const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
  const x=i=>4+312*(i+.5)/data.length;
  const y=v=>112-100*(v-min)/span;
  const bodyWidth=Math.max(.7,Math.min(6,312/data.length*.65));
  const num=v=>finite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:v>=1?2:v>=.001?5:9}):'—';
  const line=(key,color,width)=>{
    let path='',started=false;
    data.forEach((r,i)=>{if(!finite(r[key])){started=false;return;}
      path+=(started?'L':'M')+x(i).toFixed(2)+' '+y(r[key]).toFixed(2);started=true;});
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
  };
  const candles=data.map((r,i)=>{
    const up=r.close>=r.open,color=up?'var(--up)':'var(--down)';
    const top=y(Math.max(r.open,r.close)),bottom=y(Math.min(r.open,r.close));
    const body=Math.max(1,bottom-top);
    return `<g><title>${esc(dateText(r.day))} · O ${num(r.open)} · H ${num(r.high)} · L ${num(r.low)} · C ${num(r.close)}</title><line x1="${x(i).toFixed(2)}" x2="${x(i).toFixed(2)}" y1="${y(r.high).toFixed(2)}" y2="${y(r.low).toFixed(2)}" stroke="${color}" stroke-width="1"/><rect x="${(x(i)-bodyWidth/2).toFixed(2)}" y="${top.toFixed(2)}" width="${bodyWidth.toFixed(2)}" height="${body.toFixed(2)}" fill="${color}"/></g>`;
  }).join('');
  const first=data[0].day,last=data[data.length-1].day;
  const lastClose=data[data.length-1].close;
  const lastY=y(lastClose);
  const lastTop=Math.max(4,Math.min(96,lastY));
  return `<div class="chart-wrap"><div class="chart-y" aria-hidden="true"><span>${num(max)}</span><span>${num((max+min)/2)}</span><span>${num(min)}</span></div>
    <div class="chart-plot"><svg class="chart" role="img" aria-label="Японские свечи с ${dateText(first)} по ${dateText(last)}" viewBox="0 0 320 120" preserveAspectRatio="none"><path d="M0 12H320M0 62H320M0 112H320" stroke="var(--line)" fill="none"/>${line('ma200','var(--warn)',1.4)}${line('ma50','var(--info)',1.4)}${candles}<line class="last-line" x1="0" x2="320" y1="${lastY.toFixed(2)}" y2="${lastY.toFixed(2)}" stroke-width="1"/></svg><span class="chart-last" style="top:${lastTop}%">${num(lastClose)}</span></div></div>
    <div class="between sub"><span>${dateText(first)}</span><span>${dateText(last)}</span></div>
    <div class="legend"><span><i class="dot" style="background:var(--up)"></i>Рост</span><span><i class="dot" style="background:var(--down)"></i>Падение</span><span><i class="dot" style="background:var(--info)"></i>MA50</span><span><i class="dot" style="background:var(--warn)"></i>MA200</span></div>`;
}

export function coinRows(s){
  const q=s.query.trim().toLowerCase(),list=s.coins.filter(c=>(c.name+' '+c.symbol).toLowerCase().includes(q));
  const order=s.sort;
  if(order!=='rank'){
    const val=c=>order==='p24'?c.p24:s.results.get(c.id)?.cards.find(h=>h.key===order)?.total;
    list.sort((a,b)=>(val(b)??-Infinity)-(val(a)??-Infinity)||a.rank-b.rank);
  }
  return list.map(c=>{
    const score=horizons.some(h=>h.key===order)?s.results.get(c.id)?.cards.find(h=>h.key===order)?.total:null;
    return `<button class="coin" data-act="coin" data-id="${esc(c.id)}"><span class="rank">${c.rank}</span><span class="name"><strong>${esc(c.symbol)}</strong><small>${esc(c.name)}</small></span><span class="value"><strong class="price">${money(c.price)}</strong><small class="delta ${color(score??c.p24)}">${horizons.some(h=>h.key===order)?'Оценка '+sign(score,0):pct(c.p24)}</small></span></button>`;
  }).join('')||note('Совпадений нет.');
}
export function market(s){
  const fear=[...s.fear.entries()].sort((a,b)=>b[0].localeCompare(a[0]))[0];
  const btc=s.results.get('bitcoin')?.series.at(-1)?.r;
  const trend=btc&&finite(btc.ma200)?(btc.close>btc.ma200?'Восходящий':'Нисходящий'):'—';
  const partial=horizons.map(h=>{
    let total=0,weights=0;
    for(const c of s.coins){
      const value=s.results.get(c.id)?.cards.find(x=>x.key===h.key)?.total, w=Math.sqrt(c.cap||0);
      if(finite(value)&&w>0){total+=value*w;weights+=w;}
    }
    return metric(h.title,weights?sign(total/weights,0):'—');
  }).join('');
  const title=header('Обзор рынка',s.marketTime?(s.stale?'Сохранённые данные · ':'Обновлено · ')+when(s.marketTime):'Котировки и сигналы в долларах США');
  if(!s.coins.length)return title+(s.marketError
    ?empty('!','Не удалось загрузить рынок',s.marketError,act('refresh','Попробовать снова','','cta'))
    :`<div class="panel">${'<div class="skeleton skeleton-line"></div>'.repeat(3)}${'<div class="skeleton skeleton-row"></div>'.repeat(6)}</div>`);
  return title+`<section class="hero"><small>Биткоин · относительно средней за 200 дней</small><div class="big">${trend}</div><div class="metrics">${metric('BTC / USD',money(s.coins.find(c=>c.id==='bitcoin')?.price))}${metric('Страх и жадность',fear?fear[1]+' / 100':'—')}</div>${note('CoinGecko · Binance · индекс Alternative.me'+(fear?' за '+fear[0]:''))}</section>
    <section><div class="between wrap"><h2>Сигналы рынка</h2><small>По ${s.results.size} из ${s.coins.length} монет</small></div><div class="metrics">${partial}</div></section>
    <div class="between wrap"><h2>Топ монет</h2><small>${s.coins.length} по капитализации</small></div>
    <div class="toolrow"><label class="grow">Поиск<input type="search" id="search" value="${esc(s.query)}" placeholder="Bitcoin или BTC"></label>
    <label>Сортировка<select id="sort">${opts([['rank','По месту'],['p24','За сутки'],...horizons.map(h=>[h.key,h.title])],s.sort)}</select></label></div>
    <div class="between wrap">${act('analyze',s.bulk?'Остановить расчёт':'Рассчитать оценки')}<small>Рассчитано ${s.results.size} из ${s.coins.length}</small></div>
    ${s.bulk?`<div class="progress" aria-hidden="true"><span style="width:${Math.round(s.results.size/s.coins.length*100)}%"></span></div>`:''}
    ${s.bulkNote?note(s.bulkNote):''}<div class="panel list" id="coin-list">${coinRows(s)}</div>
    ${note('Оценка от −100 до 100: выше 15 — позитивный сигнал, ниже −15 — негативный. Это историческая модель, а не гарантия доходности. Источник котировок — CoinGecko.')}`;
}

export function detail(s){
  const c=s.coins.find(x=>x.id===s.selected);
  if(!c)return '';
  const d=s.results.get(c.id);
  const title=act('market','‹  Рынок')+`<section>${header(c.name,c.symbol+' · #'+c.rank+' в отфильтрованном рейтинге')}<div class="big">${money(c.price)}</div><small>Котировка · ${when(c.at)}</small><div class="metrics">${metric('24 часа',pct(c.p24))}${metric('7 дней',pct(c.p7))}${metric('30 дней',pct(c.p30))}</div></section>`;
  if(!d)return title+panel(note(s.detailError||'Загружаем дневные свечи и считаем оценки…')+(s.detailError?act('retry','Повторить'):''));
  const r=d.series.at(-1).r;
  const cards=d.cards.map((card,i)=>panel(`<div class="between"><h2>${horizons[i].title}</h2><strong class="mono ${color(card.total)}">${sign(card.total,0)} / 100</strong></div><small>${horizons[i].span}</small><p>${esc(card.verdict)}</p><small>Надёжность · ${esc(card.reliability)}</small>
  <details><summary>Факторы и модель</summary>${card.reasons.map(reason=>`<div class="row"><div class="between"><b>${esc(reason.title)}</b><span class="mono ${color(reason.points)}">${sign(reason.points)}</span></div><small>${esc(reason.note)}</small></div>`).join('')||note('Активных факторов с измеренным вкладом нет.')}
  ${note(card.prob===null?'Для модели мало истории.':'Вероятность роста по LightGBM '+fmt(card.prob*100,1)+'% · вес модели '+fmt(card.weight*100,1)+'%.')}</details>`)).join('');
  return title+`<section class="panel"><div class="between"><h2>Цена · японские свечи</h2><small>${esc(d.source)} · USD</small></div><div class="chips range-chips">${[90,365,1000].map(n=>act('range',n===90?'3 месяца':n===365?'Год':'Всё',n,s.range===n?'active':'')).join('')}</div>
  ${chart(d.series.slice(-s.range).map(x=>x.r))}<div class="metrics">${metric('RSI 14',fmt(r.rsi,1))}${metric('Волатильность / год',finite(r.vol30)?fmt(r.vol30*100)+'%':'—')}</div></section>
  <h2>Оценка по трём срокам</h2>${note('Закрытие '+dateText(r.day)+' · '+d.series.length+' дневных свечей'+(d.stale?' · сохранённая история':'')+(d.missing.length?' · недоступно: '+d.missing.join(', '):''))}
  ${cards}<div class="toolrow">${act('add','Купить',c.id,'cta')}${act('addsell','Продать',c.id)}${act('sim','Симулятор',c.id)}</div>`;
}
export function news(s){
  const n=s.news;
  let content;
  if(!n)content=`<div class="panel">${'<div class="skeleton skeleton-line"></div>'.repeat(5)}</div>`;
  else if(!n.items.length)content=empty('≋','Новостей пока нет','Ленты недоступны или не отдали публикации.',act('refresh','Обновить новости','','cta'));
  else content='<div class="chips">'+act('newsmode','Все публикации','all',!s.important?'active':'')+act('newsmode','Важные события','important',s.important?'active':'')+'</div>'+note('Доступно источников '+n.sources+' из '+n.total+(n.stale?' · есть сохранённые ленты':''))+n.items.filter(x=>!s.important||x.events.length).map(x=>`<a class="story" href="${esc(x.link)}"><small>${esc(x.source)} · ${when(x.time)}</small><strong>${esc(x.title)}</strong>${x.events.length?note(x.events.join(" · ")):""}</a>`).join('');
  if(s.important&&n?.items.length&&!n.items.some(x=>x.events.length))content+=note('В этих заголовках событий не найдено.');
  return header('Новости','Заголовки криптоизданий на языке источника')+`<section>${content}</section>`;
}
export function portfolioChart(s){
  if(s.chartBusy)return '<div class="skeleton" style="height:180px"></div>';
  if(s.chartError)return `<div class="form-error">${esc(s.chartError)}</div>${act('loadchart','Повторить')}`;
  const series=s.chartSeries?.series||[];
  if(series.length<2)return empty('↗','График появится после операции','Добавьте покупку — и здесь появится динамика стоимости и вложений.',act('add','Добавить операцию','','cta'));
  const vals=series.flatMap(r=>[r.value,r.invested]).filter(finite);
  const min=Math.min(0,...vals),max=Math.max(...vals),span=max-min||1;
  const x=i=>4+312*(i+.5)/series.length;
  const y=v=>112-100*(v-min)/span;
  const line=key=>{
    let path='',started=false;
    series.forEach((r,i)=>{if(!finite(r[key])){started=false;return;}
      path+=(started?'L':'M')+x(i).toFixed(2)+' '+y(r[key]).toFixed(2);started=true;});
    return path;
  };
  const last=series[series.length-1];
  const rub=v=>finite(v)?fmt(v,0)+' ₽':'—';
  const axis=v=>{const a=Math.abs(v);return a>=1e6?fmt(v/1e6,1)+' млн':a>=1e3?fmt(v/1e3,0)+' тыс.':fmt(v,0);};
  const lastTop=Math.max(4,Math.min(96,y(last.value??min)));
  return `<div class="chart-wrap"><div class="chart-y" aria-hidden="true"><span>${axis(max)}</span><span>${axis((max+min)/2)}</span><span>${axis(min)}</span></div>
    <div class="chart-plot"><svg class="chart" role="img" aria-label="Стоимость портфеля с ${dateText(series[0].day)} по ${dateText(last.day)}" viewBox="0 0 320 120" preserveAspectRatio="none"><path d="M0 12H320M0 62H320M0 112H320" stroke="var(--line)" fill="none"/><path d="${line('invested')}" fill="none" stroke="var(--warn)" stroke-width="1.4" vector-effect="non-scaling-stroke"/><path d="${line('value')}" fill="none" stroke="var(--up)" stroke-width="2" vector-effect="non-scaling-stroke"/><line class="last-line" x1="0" x2="320" y1="${y(last.value??min).toFixed(2)}" y2="${y(last.value??min).toFixed(2)}" stroke-width="1"/></svg><span class="chart-last" style="top:${lastTop}%">${rub(last.value)}</span></div></div>
    <div class="between sub"><span>${dateText(series[0].day)}</span><span>${dateText(last.day)}</span></div>
    <div class="legend"><span><i class="dot" style="background:var(--up)"></i>Стоимость</span><span><i class="dot" style="background:var(--warn)"></i>Чистые вложения</span></div>
    ${!s.chartSeries.complete?note('Часть истории цен недоступна — график может быть неполным.'):''}
    ${s.chartNote?note(s.chartNote):''}
    ${note('Оценка в текущем курсе ₽. Линия вложений — внесённые деньги минус выручка от продаж.')}`;
}

export function alertsPanel(s){
  const coins=s.coinUniverse||s.coins;
  const alerts=s.alerts||[];
  const enabled=s.notifEnabled!==false;
  const target=a=>a.currency==='rub'&&finite(a.targetRub)?fmt(a.targetRub,0)+' ₽':money(a.targetUsd);
  const rows=alerts.map(a=>{
    const status=!a.enabled?(a.triggeredAt?'сработало':'выключено'):'ждёт';
    return `<div class="row">
      <div class="between"><b>${esc(a.symbol)} ${a.above?'≥':'≤'} ${target(a)}</b><span class="badge ${a.triggeredAt?'live':''}">${status}</span></div>
      <small>${a.currency==='rub'?'Цель в рублях':'Цель в долларах'}${a.triggeredAt?' · '+dateText(new Date(a.triggeredAt).toISOString().slice(0,10)):''}</small>
      <div class="toolrow">${!a.enabled&&a.triggeredAt?act('realert','Включить снова',a.key):''}${s.removeAlert===a.key?act('delalert','Удалить','','danger')+act('cancelalert','Отмена'):act('askdelalert','Удалить',a.key)}</div>
    </div>`;
  }).join('');
  const form=coins.length?`<details class="panel"><summary>Добавить уведомление</summary>
    <form id="alert-form">
      <label>Монета<select name="coin">${opts(coins.map(c=>[c.id,c.symbol+' · '+c.name]),coins[0].id)}</select></label>
      <div class="grid2"><label>Условие<select name="dir"><option value="above">Цена выше</option><option value="below">Цена ниже</option></select></label>
      <label>Валюта цели<select name="currency"><option value="rub">Рубли</option><option value="usd">Доллары</option></select></label></div>
      <label>Целевая цена<span class="field"><input name="target" inputmode="decimal" type="text" placeholder="0" required><span class="suffix">₽ / $</span></span></label>
      <div class="form-error" id="alert-error" role="alert"></div>
      <button type="submit" class="cta">Сохранить уведомление</button>
    </form></details>`:empty('🔔','Нет монет для уведомления','Сначала загрузите котировки на вкладке «Рынок».');
  return `<section><div class="between wrap"><h2>Уведомления о цене</h2><span class="badge ${enabled?'':'live'}">${enabled?'разрешены':'не разрешены'}</span></div>
    ${!enabled?`${note('Android не показывает уведомления без разрешения.')}<div class="toolrow">${act('notifperm','Разрешить уведомления','','cta')}${act('notifsettings','Настройки')}</div>`:''}
    ${alerts.length?`<div class="toolrow">${act('alertnow','Проверить сейчас')}</div>`:''}
    ${rows||empty('🔔','Пока нет уведомлений','Задайте цену — приложение сообщит, когда она будет достигнута.')}
    ${form}
    ${note('Проверка выполняется примерно раз в 15–30 минут при интернете. Это не стоп-лосс: цена может пройти цель между проверками.')}
  </section>`;
}

export function portfolio(s){
  const rate=s.fx?.rate,currency=s.currency==='usd'?'usd':'rub';
  const coins=s.coinUniverse||s.coins;
  const sum=summarize(s.txs,coins,rate);
  const conv=rub=>currency==='usd'?(finite(rate)&&rate>0?rub/rate:null):rub;
  const show=rub=>{const v=conv(rub);return finite(v)?(currency==='usd'?money(v):fmt(v,2)+' ₽'):'—';};
  const coinById=new Map(coins.map(c=>[c.id,c]));
  const rateNote=s.fx?`Курс ЦБ: 1 $ = ${fmt(s.fx.rate,2)} ₽${s.fx.stale?' · кэш':''}`:(s.fxError||'Курс USD/RUB недоступен — стоимость в рублях неполная.');
  const tab=s.portfolioTab||'overview';
  const advice=b=>{
    const cards=s.results.get(b.coin)?.cards;
    if(!cards)return '';
    const [short,medium,long]=cards.map(c=>c.total);
    const text=long>=15&&medium>=15?(short<=-30?'Держать. Докупать лучше после отката.':'Держать и можно докупать.')
      :long>=15?'Держать. Долгий тренд хороший.':long<=-50&&medium<=-15?'Слабая монета — подумать о частичной продаже.'
      :long<=-15&&medium<=-15?'Не докупать, следить внимательно.':medium>=15?'Держать, среднесрочно неплохо.':'Держать, явных сигналов нет.';
    return note(text);
  };
  const importPanel=Array.isArray(s.importTxs)?`<section><h2>Импорт портфеля</h2><div class="panel">
    <div class="between"><b>Найдено операций: ${s.importTxs.length}</b>${s.importSkipped?`<small>пропущено ${s.importSkipped}</small>`:''}</div>
    ${note('«Заменить» удалит текущие операции и оставит только импортированные. «Добавить» сохранит текущие и дозапишет новые без дублей.')}
    <div class="toolrow">${act('importreplace','Заменить портфель','','cta')}${act('importmerge','Добавить к текущему')}${act('importcancel','Отмена')}</div>
  </div></section>`:'';
  const toggle=`<div class="chips">${act('currency','₽','rub',currency==='rub'?'active':'')}${act('currency','$','usd',currency==='usd'?'active':'')}</div>`;
  const plClass=v=>v>0?'up':v<0?'down':'';
  const txRow=(tx,actions=true)=>{
    const rub=txRub(tx,rate),fee=txFee(tx),qty=Number(tx.qty),price=finite(rub)&&finite(qty)&&qty>0?rub/qty:null;
    const sell=tx.type==='sell';
    return `<div class="tx ${sell?'sell':'buy'}"><span class="tx-icon" aria-hidden="true">${sell?'−':'+'}</span>
      <div class="tx-main"><strong>${sell?'Продажа':'Покупка'} ${esc(tx.symbol)}</strong><small>${dateText(tx.day)} · ${fmt(qty,8)} × ${show(price)}${fee?` · комиссия ${show(fee)}`:''}${tx.legacy?' · из USD':''}</small>${tx.note?`<small>${esc(tx.note)}</small>`:''}</div>
      <div class="tx-side"><b class="${sell?'':'up'}">${show(rub)}</b>${actions&&s.remove!==tx.key?`<details class="menu"><summary aria-label="Действия">⋯</summary><div class="menu-list">${act('askedit','Изменить',tx.key)}${act('askdelete','Удалить',tx.key)}</div></details>`:''}</div></div>
      ${actions&&s.remove===tx.key?`<div class="toolrow"><button type="button" class="danger" data-act="delete" data-id="${esc(tx.key)}">Удалить операцию</button>${act('canceldelete','Отмена')}</div>`:''}`;
  };
  const recent=s.txs.length?`<section><div class="between"><h2>Последние операции</h2>${act('ptab','Все','history')}</div>${sortTxs(s.txs).slice(-3).reverse().map(tx=>txRow(tx,false)).join('')}</section>`:'';
  const positions=sum.holdings.map(p=>{
    const c=coinById.get(p.coin);
    return `<div class="pos"><div class="pos-head"><div><strong>${esc(p.symbol)}</strong> <span class="badge">${esc(c?.name||'')}</span></div><b>${show(p.value)}</b></div>
      <div class="pos-meta"><span>${fmt(p.qty,8)} · средняя ${show(p.avg)}</span><span>${finite(p.priceRub)?fmt(p.priceRub,2)+' ₽':'—'}</span></div>
      <div class="between"><span class="pos-pl">Прибыль: <b class="${plClass(p.pl)}">${show(p.pl)}${finite(p.plPct)?' ('+sign(p.plPct,1)+'%)':''}</b></span>${s.coins.some(x=>x.id===p.coin)?act('coin','Анализ',p.coin):''}</div>
      ${advice(p)}</div>`;
  }).join('');
  const txs=sortTxs(s.txs).slice().reverse();
  const groups=[];
  const byMonth=new Map();
  for(const tx of txs){const key=String(tx.day).slice(0,7);if(!byMonth.has(key)){byMonth.set(key,[]);groups.push(key);}byMonth.get(key).push(tx);}
  const history=groups.map(key=>`<div class="month">${monthText(byMonth.get(key)[0].day)}</div>${byMonth.get(key).map(tx=>txRow(tx)).join('')}`).join('');
  const overview=`<section><div class="between wrap"><h2>Динамика</h2><small>${s.chartBusy?'считаем…':'в рублях'}</small></div>
    <div class="chips">${[90,365,1000].map(n=>act('chartrange',n===90?'3 месяца':n===365?'Год':'Всё',n,s.portfolioRange===n?'active':'')).join('')}</div>
    ${portfolioChart(s)}</section>${recent}`;
  const content=tab==='positions'?`<section><h2>Позиции</h2>${positions||empty('◇','Открытых позиций нет','Добавьте покупку, чтобы увидеть здесь свои монеты.',act('add','Добавить операцию','','cta'))}</section>`
    :tab==='history'?`<section><h2>История операций</h2>${history||empty('≡','Операций пока нет','Первая покупка займёт меньше минуты.',act('add','Добавить операцию','','cta'))}</section>`
    :tab==='alerts'?alertsPanel(s)
    :overview;
  return header('Мой портфель','Покупки и продажи хранятся на этом устройстве')+
    `<div class="between wrap"><span class="sub">${rateNote}</span>${toggle}</div>`+
    `<div class="hero summary-card"><div class="summary-head"><div><small>Текущая стоимость</small><div class="big">${show(sum.value)}</div><small class="${plClass(sum.total)}">${sum.total==null?'Итог неполный':'Общий результат: '+show(sum.total)}</small></div>
      <div class="summary-actions">${act('export','Экспорт')}${act('import','Импорт')}</div></div>
      <div class="metrics">${metric('В позициях',show(sum.cost))}${metric('Бумажная прибыль',show(sum.unrealized),plClass(sum.unrealized))}${metric('Общий результат',show(sum.total),plClass(sum.total))}</div>
      <details><summary>Детали расчёта</summary><div class="facts"><div class="fact"><span>Куплено</span><b>${show(sum.totalBuy)}</b></div><div class="fact"><span>Продано</span><b>${show(sum.totalSell)}</b></div><div class="fact"><span>Комиссии</span><b>${show(sum.fees)}</b></div><div class="fact"><span>Реализованная прибыль</span><b class="${plClass(sum.realized)}">${show(sum.realized)}</b></div></div></details>
      ${!sum.complete?note('Не по всем монетам есть цена — стоимость неполная.'):''}
      ${sum.oversold?note('Есть продажи больше остатка — они обрезаны при расчёте.'):''}
      ${sum.invalid?note('Не удалось прочитать операций: '+sum.invalid+'.'):''}
    </div>`+
    importPanel+
    `<div class="segments" role="tablist">${[['overview','Обзор'],['positions','Позиции'],['history','История'],['alerts','Уведомления']].map(([id,label])=>`<button type="button" role="tab" aria-selected="${tab===id}" class="${tab===id?'active':''}" data-act="ptab" data-id="${id}">${label}${id==='alerts'&&s.alerts?.length?` · ${s.alerts.length}`:''}</button>`).join('')}</div>`+
    content+
    `<button type="button" class="fab" data-act="add" aria-label="Добавить операцию" title="Добавить операцию">+</button>`;
}

export function coinSearchResults(s){
  if(s.searchBusy)return note('Ищем монеты в CoinGecko…');
  if(s.searchError)return note(s.searchError);
  if(!s.searchResults)return note('Введите название или тикер и нажмите «Найти».');
  if(!s.searchResults.length)return note('Ничего не найдено. Проверьте название или тикер.');
  return s.searchResults.map(c=>`<button type="button" class="coin" data-act="pickcoin" data-id="${esc(c.id)}"><span class="rank">${c.rank<9999?c.rank:'•'}</span><span class="name"><strong>${esc(c.symbol)}</strong><small>${esc(c.name)}</small></span></button>`).join('');
}

export function buyForm(s){
  const edit=s.editTx?s.txs.find(t=>t.key===s.editTx):null;
  const coins=s.coinUniverse||s.coins;
  if(!coins.length&&!edit)return header('Новая операция')+panel(note('Сначала загрузите котировки на вкладке «Рынок».')+act('market','Открыть рынок'));
  const draft=s.txDraft||{};
  const type=s.txType==='sell'?'sell':'buy';
  const coinId=edit?.coin??draft.coin??s.buyCoin;
  let c=coins.find(x=>x.id===coinId);
  if(!c&&edit)c={id:edit.coin,symbol:edit.symbol,name:edit.symbol};
  if(!c)c=coins[0];
  const options=coins.map(x=>[x.id,x.symbol+' · '+x.name]);
  if(!options.some(([id])=>id===c.id))options.unshift([c.id,c.symbol+' · '+c.name]);
  const held=availableAt(s.txs.filter(t=>t.key!==edit?.key),c.id,s.today);
  const title=edit?'Редактировать операцию':'Новая операция';
  const value=(field,fallback='')=>{
    if(edit)return edit[field]??fallback;
    return draft[field]??fallback;
  };
  const searchBlock=edit?'':`<details class="panel"><summary>Нет монеты в списке? Найти в CoinGecko</summary>
    <div class="toolrow"><label class="grow">Название или тикер<input type="search" id="coin-search" value="${esc(s.coinSearch||'')}" placeholder="например, pepe"></label>${act('coinsearch','Найти')}</div>
    <div id="coin-search-results" class="list">${coinSearchResults(s)}</div>
    <small>Можно добавить любую монету из каталога CoinGecko. Цена подтянется автоматически.</small>
  </details>`;
  return act('portfolio','‹  Портфель')+`<section>${header(title,type==='sell'?'Продажа крипты за рубли':'Покупка крипты за рубли')}
    <div class="chips">${act('txtype','Покупка','buy',type==='buy'?'active':'')}${act('txtype','Продажа','sell',type==='sell'?'active':'')}</div>
    <form id="tx-form" class="panel" novalidate>
      <input type="hidden" name="type" value="${type}">
      <label>Монета<select id="tx-coin" name="coin">${opts(options,c.id)}</select></label>
      <div class="grid2">
        <label>Количество ${esc(c.symbol)}<span class="field"><input name="qty" inputmode="decimal" type="text" placeholder="0" value="${edit?esc(edit.qty):esc(draft.qty||'')}" required><span class="suffix">${esc(c.symbol)}</span></span></label>
        <label>Сумма, ₽<span class="field"><input name="rub" inputmode="decimal" type="text" placeholder="0" value="${edit&&edit.rub!=null?esc(edit.rub):esc(draft.rub||'')}" required><span class="suffix">₽</span></span></label>
      </div>
      <div class="grid2">
        <label>Комиссия<span class="field"><input name="fee" inputmode="decimal" type="text" placeholder="0" value="${edit&&Number(edit.fee)>0?esc(edit.fee):esc(draft.fee||'')}"><span class="suffix">₽</span></span></label>
        <label>Дата<input name="day" type="date" value="${edit?esc(edit.day):esc(draft.day||s.today)}" max="${s.today}" required></label>
      </div>
      ${type==='sell'?`<div class="quick" aria-label="Доля продажи">${[25,50,75,100].map(n=>act('sellpct',n===100?'Всё':n+'%',n)).join('')}</div>`:''}
      <label>Заметка<input name="note" maxlength="160" value="${edit?esc(edit.note):esc(draft.note||'')}" placeholder="необязательно"></label>
      <div id="tx-calc" class="sub"></div>
      <div class="form-error" id="tx-error" role="alert"></div>
      <div class="form-actions"><button type="submit" class="cta">${edit?'Сохранить изменения':'Сохранить операцию'}</button>${edit?act('canceledit','Отмена'):''}</div>
    </form>
    ${type==='sell'?note('Доступно: '+fmt(held,8)+' '+c.symbol+'. Можно продать не больше остатка на выбранную дату.'):''}
    ${note('Сумма — фактически потраченные или полученные деньги без комиссии. Комиссия увеличивает стоимость покупки или уменьшает выручку.')}
    ${searchBlock}
  </section>`;
}

export function simulator(s){
  const d=s.results.get(s.selected);if(!d)return '';
  const list=d.series, end=list.at(-1).r.day, min=list[0].r.day;
  const initial=list[Math.max(0,list.length-365)].r.day;
  const symbol=s.coins.find(c=>c.id===s.selected)?.symbol;
  return act('coin','‹  '+symbol,s.selected)+`<section>${header('Симулятор покупок',symbol+' · доступная история '+min+' — '+end)}
    <form id="sim-form" class="panel" novalidate><div class="grid2"><label>Сумма в неделю<span class="field"><input name="weekly" inputmode="decimal" type="text" value="100" required><span class="suffix">$</span></span></label>
    <label>Начало<input name="start" type="date" min="${min}" max="${end}" value="${initial}" required></label></div>
    <div class="grid2"><label>Страх, ≤<input name="fear" inputmode="numeric" type="text" value="25" required></label><label>Жадность, ≥<input name="greed" inputmode="numeric" type="text" value="75" required></label></div>
    <div class="form-error" id="sim-error" role="alert"></div>
    <button type="submit" class="cta">Сравнить стратегии</button></form><div id="simulation"></div>${note('Покупки по понедельникам, без комиссий. Страх увеличивает взнос в 1,5 раза, жадность уменьшает вдвое. Для сигналов используются веса, обученные до года покупки. При нехватке данных взнос обычный.')}</section>`;
}
export function simResult(rs){
  return rs.map(r=>panel(`<div class="between"><strong>${esc(r.title)}</strong><b class="mono ${color(r.ret)}">${pct(r.ret)}</b></div><small>Вложено ${money(r.invested)} · в конце ${money(r.value)}</small>`)).join('');
}
export function research(s){
  const f=s.models.factors, report=s.models.report, journal=s.journal;
  const done=(journal||[]).filter(j=>j.ret!==null&&Math.abs(j.total)>=15);
  const hits=done.filter(j=>j.total>=15?j.ret>0:j.ret<=0).length;
  const release=s.release;
  const updatePanel=`<section><h2>Версия приложения</h2><div class="panel">
    <div class="between"><b>Установлено: ${esc(s.version||'dev')}</b><small>${release?'GitHub: '+esc(release.tag):''}</small></div>
    ${release?note('Последний релиз на GitHub: '+esc(release.tag)+'.'):''}
    ${s.updateAvailable?note('Доступна новая версия '+esc(release.tag)+'.'):''}
    ${s.releaseError?note(s.releaseError):''}
    <div class="toolrow">${act('update-app','Обновить приложение','','cta')}${act('checkupdate','Только проверить')}</div>
    <div id="update-status" class="sub"></div>
    <div class="toolrow"><a class="cta" href="${esc(s.releasesUrl)}">Открыть GitHub Releases</a></div>
    ${note('«Обновить приложение» проверит GitHub, скачает APK и откроет системный установщик. Android покажет подтверждение установки — это обязательный системный шаг.')}
  </div></section>`;
  return header('Советник','Историческая проверка модели и журнал ваших прогнозов')+updatePanel+
    `<div class="hero"><small>Модель на истории</small><div class="big">${f.coins} монет</div>${note(f.period+' · '+fmt(f.samples,0)+' наблюдений')}</div>
    <h2>Историческая проверка</h2>${horizons.map(h=>{const d=f.horizons[h.key],m=report.horizons[h.key].metrics;return panel(`<div class="between"><b>${h.title}</b><small>${esc(d.reliability[0])}</small></div>
    <p>${esc(d.reliability[1])}</p><small>LightGBM · AUC ${fmt(m.auc,3)} · проверено ${fmt(m.n,0)} прогнозов</small>`);}).join('')}
    ${note('Модели обучены '+dateText(report.trained_at.slice(0,10))+'. Это проверка настольной модели на истории, а не прогноз доходности.')}
    <section><h2>Мои прогнозы</h2>${journal?note('Записей '+journal.length+' · проверено направленных сигналов '+done.length+(done.length?' · верных '+hits+' ('+fmt(hits/done.length*100,1)+'%)':'')):''}${note('Прогноз сохраняется при расчёте по свежим данным. Результат сверяется при следующем анализе этой монеты после даты проверки.')}
    ${journal===null?note('Загрузка журнала…'):journal.length?journal.slice(0,60).map(j=>`<div class="row"><div class="between"><b>${esc(j.symbol)} · ${horizons.find(h=>h.key===j.horizon)?.days} дн.</b><span class="mono">${sign(j.total,0)}</span></div><small>${dateText(j.day)} → ${dateText(j.due)} · ${j.ret===null?'ожидает проверки':'изменение '+pct(j.ret*100)}</small></div>`).join(''):note('Записей пока нет. Откройте монету или рассчитайте оценки на экране рынка.')}</section>`;
}
