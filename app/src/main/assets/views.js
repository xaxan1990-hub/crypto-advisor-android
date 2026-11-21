import {finite,horizons} from './analysis.js';

export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const fmt=(n,d=2)=>finite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—';
export const money=n=>finite(n)?'$'+fmt(n,n>=1?2:n>=.001?5:9):'—';
const sign=(v,d=1)=>finite(v)?(v>0?'+':'')+fmt(v,d):'—';
const color=v=>v>0?'up':v<0?'down':'';
const pct=v=>finite(v)?sign(v)+'%':'—';
export const when=t=>finite(t)&&t>0?new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const act=(a,label,id='',cls='')=>`<button class="${cls}" data-act="${a}" data-id="${esc(id)}">${esc(label)}</button>`;
const panel=s=>`<div class="panel">${s}</div>`;
const metric=(name,value)=>`<div class="metric"><small>${esc(name)}</small><strong class="mono">${esc(value)}</strong></div>`;
const header=(title,sub='')=>`<h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>`;
const opts=(list,current)=>list.map(([id,label])=>`<option value="${esc(id)}" ${id===current?'selected':''}>${esc(label)}</option>`).join('');
const note=s=>`<p class="sub">${esc(s)}</p>`;
export function chart(rows){
  if(rows.length<2)return note('Недостаточно точек для графика.');
  const vals=rows.flatMap(r=>[r.close,r.ma50,r.ma200]).filter(finite);
  const min=Math.min(...vals), max=Math.max(...vals), span=max-min||1;
  const x=i=>4+312*i/(rows.length-1), y=v=>100-95*(v-min)/span;
  const line=(key,color,width)=>{
    let path='',started=false;
    rows.forEach((r,i)=>{if(!finite(r[key])){started=false;return;}
      path+=(started?'L':'M')+x(i).toFixed(2)+' '+y(r[key]).toFixed(2);started=true;});
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
  };
  return `<svg class="chart" role="img" aria-label="Цена и скользящие средние с ${rows[0].day} по ${rows[rows.length-1].day}" viewBox="0 0 320 108" preserveAspectRatio="none"><path d="M0 20H320M0 55H320M0 95H320" stroke="#324238" fill="none"/>${line('ma200','#da9a70',1.4)}${line('ma50','#7db1cf',1.4)}${line('close','#baf295',2)}</svg>
    <div class="between sub"><span>${rows[0].day}</span><span>${rows[rows.length-1].day}</span></div>
    <div class="legend"><span>Цена · зелёная</span><span>MA50 · синяя</span><span>MA200 · медная</span></div>`;
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
    return `<button class="coin" data-act="coin" data-id="${esc(c.id)}"><span class="rank">${c.rank}</span><span class="name"><strong>${esc(c.symbol)}</strong><small>${esc(c.name)}</small></span><span class="value"><strong class="price">${money(c.price)}</strong><small class="delta ${color(score??c.p24)}">${horizons.some(h=>h.key===order)?'Баллы '+sign(score,0):pct(c.p24)}</small></span></button>`;
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
  const title=header('Обзор рынка',s.marketTime?(s.stale?'Сохранённые данные · ':'Получено с CoinGecko · ')+when(s.marketTime):'Котировки и сигналы в долларах США');
  if(!s.coins.length)return title+panel(note(s.marketError||'Загружаем рейтинг CoinGecko…')+(s.marketError?act('refresh','Попробовать снова'):''));
  return title+`<section class="hero"><small>Биткоин · относительно средней за 200 дней</small><div class="big">${trend}</div><div class="metrics">${metric('BTC / USD',money(s.coins.find(c=>c.id==='bitcoin')?.price))}${metric('Страх и жадность',fear?fear[1]+' / 100':'—')}</div>${note('CoinGecko · Binance · индекс Alternative.me'+(fear?' за '+fear[0]:''))}</section>
    <section><div class="between wrap"><h2>Сигналы рынка</h2><small>По ${s.results.size} из ${s.coins.length} монет</small></div><div class="metrics">${partial}</div></section>
    <div class="between wrap"><h2>Топ монет</h2><small>${s.coins.length} по капитализации</small></div>
    <div class="toolrow"><label class="grow">Поиск<input type="search" id="search" value="${esc(s.query)}" placeholder="Bitcoin или BTC"></label>
    <label>Сортировка<select id="sort">${opts([['rank','По месту'],['p24','За сутки'],...horizons.map(h=>[h.key,h.title])],s.sort)}</select></label></div>
    <div class="between wrap">${act('analyze',s.bulk?'Остановить расчёт':'Рассчитать оценки')}<small>Рассчитано ${s.results.size} из ${s.coins.length}</small></div>
    ${s.bulkNote?note(s.bulkNote):''}<div class="panel list" id="coin-list">${coinRows(s)}</div>
    ${note('Источник котировок — CoinGecko. Оценки отражают исторические сигналы и не гарантируют доходность.')}`;
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
  return title+`<section class="panel"><div class="between"><h2>Цена</h2><small>${esc(d.source)} · USD</small></div><div class="chips">${[90,365,1000].map(n=>act('range',n===90?'3 месяца':n===365?'Год':'Всё',n,s.range===n?'active':'')).join('')}</div>
  ${chart(d.series.slice(-s.range).map(x=>x.r))}<div class="metrics">${metric('RSI 14',fmt(r.rsi,1))}${metric('Волатильность / год',finite(r.vol30)?fmt(r.vol30*100)+'%':'—')}</div></section>
  <h2>Оценка по трём срокам</h2>${note('Закрытие '+r.day+' UTC · '+d.series.length+' дневных свечей'+(d.stale?' · сохранённая история':'')+(d.missing.length?' · недоступно: '+d.missing.join(', '):''))}
  ${cards}<div class="toolrow">${act('add','Записать покупку',c.id,'cta')}${act('sim','Симулятор',c.id)}</div>`;
}
export function news(s){
  const n=s.news;
  let content;
  if(!n)content=note('Читаем ленты изданий…');
  else if(!n.items.length)content=panel(note('Ленты пока недоступны.')+act('refresh','Обновить новости'));
  else content='<div class="chips">'+act('newsmode','Все публикации','all',!s.important?'active':'')+act('newsmode','Важные события','important',s.important?'active':'')+'</div>'+note('Доступно источников '+n.sources+' из '+n.total+(n.stale?' · есть сохранённые ленты':''))+n.items.filter(x=>!s.important||x.events.length).map(x=>`<a class="story" href="${esc(x.link)}"><small>${esc(x.source)} · ${when(x.time)}</small><strong>${esc(x.title)}</strong>${x.events.length?note(x.events.join(" · ")):""}</a>`).join('');
  if(s.important&&n?.items.length&&!n.items.some(x=>x.events.length))content+=note('В этих заголовках событий не найдено.');
  return header('Новости','Заголовки криптоизданий на языке источника')+`<section>${content}</section>`;
}
export function portfolio(s){
  const prices=new Map(s.coins.map(c=>[c.id,c.price]));
  const advice=b=>{
    const cards=s.results.get(b.coin)?.cards;
    if(!cards)return '';
    const [short,medium,long]=cards.map(c=>c.total);
    const text=long>=15&&medium>=15?(short<=-30?'Держать. Докупать лучше после отката.':'Держать и можно докупать.')
      :long>=15?'Держать. Долгий тренд хороший.':long<=-50&&medium<=-15?'Слабая монета — подумать о частичной продаже.'
      :long<=-15&&medium<=-15?'Не докупать, следить внимательно.':medium>=15?'Держать, среднесрочно неплохо.':'Держать, явных сигналов нет.';
    return note(text);
  };
  const legs=s.buys.map(b=>({...b,cost:b.qty*b.price,now:prices.has(b.coin)?prices.get(b.coin)*b.qty:null}));
  const spent=legs.reduce((a,b)=>a+b.cost,0),all=legs.every(b=>b.now!==null);
  const value=all?legs.reduce((a,b)=>a+b.now,0):null;
  return header('Мой портфель','Покупки сохраняются на этом устройстве')+`<div class="hero"><small>Текущая стоимость</small><div class="big">${money(value)}</div><div class="metrics">${metric('Вложено',money(spent))}${metric('Результат',value===null?'Нет котировки':money(value-spent))}</div></div>
  ${s.marketTime?note((s.stale?'Сохранённые котировки · ':'Котировки получены · ')+when(s.marketTime)):''}${act('add','Добавить покупку','','cta')}
  <section><h2>Покупки</h2>${legs.length?legs.map(b=>panel(`<div class="between"><strong>${esc(b.symbol)}</strong><strong class="mono">${money(b.now)}</strong></div>
  <small>${esc(b.day)} · ${fmt(b.qty,10)} × ${money(b.price)}</small>${b.note?`<p>${esc(b.note)}</p>`:''}
  ${advice(b)}${prices.has(b.coin)?act('coin','Анализ монеты',b.coin):''}<div class="between"><span class="${b.now===null?'':color(b.now-b.cost)}">${b.now===null?'Котировка недоступна':money(b.now-b.cost)}</span>${s.remove===b.key?act('delete','Подтвердить удаление',b.key)+act('canceldelete','Отмена'):act('askdelete','Удалить',b.key)}</div>`)).join(''):note('Пока нет записанных покупок.')}</section>`;
}
export function buyForm(s){
  if(!s.coins.length)return header('Новая покупка')+panel(note('Сначала загрузите котировки на вкладке «Рынок».')+act('market','Открыть рынок'));
  const c=s.coins.find(c=>c.id===s.buyCoin)||s.coins[0];
  return act('portfolio','‹  Портфель')+`<section>${header('Новая покупка')}<form id="buy-form" class="panel">
  <label>Монета<select id="buy-coin" name="coin">${opts(s.coins.map(c=>[c.id,c.symbol+' · '+c.name]),c.id)}</select></label>
  <label>Количество<input name="qty" inputmode="decimal" type="number" step="any" min="0" required></label>
  <label>Цена покупки, USD<input name="price" inputmode="decimal" type="number" step="any" min="0" value="${esc(c.price)}" required></label>
  <label>Дата покупки<input name="day" type="date" value="${s.today}" max="${s.today}" required></label>
  <label>Заметка<input name="note" maxlength="160"></label><button class="cta">Сохранить покупку</button></form></section>`;
}
export function simulator(s){
  const d=s.results.get(s.selected);if(!d)return '';
  const list=d.series, end=list.at(-1).r.day, min=list[0].r.day;
  const initial=list[Math.max(0,list.length-365)].r.day;
  const symbol=s.coins.find(c=>c.id===s.selected)?.symbol;
  return act('coin','‹  '+symbol,s.selected)+`<section>${header('Симулятор покупок',symbol+' · доступная история '+min+' — '+end)}
    <form id="sim-form" class="panel"><div class="grid2"><label>Сумма в неделю, USD<input name="weekly" type="number" step="any" min="0.01" value="100" required></label>
    <label>Начало<input name="start" type="date" min="${min}" max="${end}" value="${initial}" required></label></div>
    <div class="grid2"><label>Страх, ≤<input name="fear" type="number" min="0" max="99" value="25" required></label><label>Жадность, ≥<input name="greed" type="number" min="1" max="100" value="75" required></label></div>
    <button class="cta">Сравнить стратегии</button></form><div id="simulation"></div>${note('Покупки по понедельникам, без комиссий. Страх увеличивает взнос в 1,5 раза, жадность уменьшает вдвое. Для сигналов используются веса, обученные до года покупки. При нехватке данных взнос обычный.')}</section>`;
}
export function simResult(rs){
  return rs.map(r=>panel(`<div class="between"><strong>${esc(r.title)}</strong><b class="mono ${color(r.ret)}">${pct(r.ret)}</b></div><small>Вложено ${money(r.invested)} · в конце ${money(r.value)}</small>`)).join('');
}
export function research(s){
  const f=s.models.factors, report=s.models.report, journal=s.journal;
  const done=(journal||[]).filter(j=>j.ret!==null&&Math.abs(j.total)>=15);
  const hits=done.filter(j=>j.total>=15?j.ret>0:j.ret<=0).length;
  return header('Проверка советника','Исторические результаты и журнал этого устройства')+
    `<div class="hero"><small>Калибровка факторов</small><div class="big">${f.coins} монет</div>${note(f.period+' · '+fmt(f.samples,0)+' наблюдений')}</div>
    <h2>Проверка по годам</h2>${horizons.map(h=>{const d=f.horizons[h.key],m=report.horizons[h.key].metrics;return panel(`<div class="between"><b>${h.title}</b><small>${esc(d.reliability[0])}</small></div>
    <p>${esc(d.reliability[1])}</p><small>LightGBM · AUC ${fmt(m.auc,3)} · проверено ${fmt(m.n,0)} прогнозов</small>`);}).join('')}
    ${note('Модели обучены '+report.trained_at.slice(0,10)+'. Эти результаты относятся к проверке настольной модели на истории.')}
    <section><h2>Журнал телефона</h2>${journal?note('Записей '+journal.length+' · проверено направленных сигналов '+done.length+(done.length?' · верных '+hits+' ('+fmt(hits/done.length*100,1)+'%)':'')):''}${note('Прогноз сохраняется при расчёте по свежим данным. Результат сверяется при следующем анализе этой монеты после даты проверки.')}
    ${journal===null?note('Загрузка журнала…'):journal.length?journal.slice(0,60).map(j=>`<div class="row"><div class="between"><b>${esc(j.symbol)} · ${horizons.find(h=>h.key===j.horizon)?.days} дн.</b><span class="mono">${sign(j.total,0)}</span></div><small>${j.day} → ${j.due} · ${j.ret===null?'ожидает проверки':'изменение '+pct(j.ret*100)}</small></div>`).join(''):note('Записей пока нет. Откройте монету или рассчитайте оценки на экране рынка.')}</section>`;
}
