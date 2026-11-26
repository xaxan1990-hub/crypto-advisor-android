import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as view from '../app/src/main/assets/views.js';

const models = Object.fromEntries(['config', 'factors', 'report', 'short', 'medium', 'long'].map(name => [
  name,
  JSON.parse(readFileSync(new URL('../app/src/main/assets/models/' + name + '.json', import.meta.url))),
]));

const coins = [
  {id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1, price: 100000, p24: 1, p7: 2, p30: 3, cap: 1e12, at: Date.now()},
  {id: 'ethereum', symbol: 'ETH', name: 'Ethereum', rank: 2, price: 3000, p24: 1, p7: 2, p30: 3, cap: 1e11, at: Date.now()},
];

const base = {
  coins,
  results: new Map(),
  fear: new Map(),
  txs: [],
  fx: {rate: 80, date: '2026-11-27', source: 'ЦБ РФ', stale: false},
  fxError: '',
  currency: 'rub',
  today: '2026-11-27',
  version: '0.7.1',
  releasesUrl: 'https://github.com/xaxan1990-hub/crypto-advisor-android/releases',
  release: null,
  releaseError: '',
  updateAvailable: false,
  remove: null,
  buyCoin: null,
  txType: 'buy',
  models,
  journal: [],
  selected: 'ethereum',
  detailError: '',
  range: 365,
  query: '',
  sort: 'rank',
  marketTime: Date.now(),
  stale: false,
  marketError: '',
  bulk: false,
  bulkNote: '',
};

test('portfolio renders RUB, buy/sell rows and P&L', () => {
  const s = {
    ...base,
    txs: [
      {key: 'a', type: 'buy', coin: 'ethereum', symbol: 'ETH', qty: 1, rub: 200000, day: '2026-11-20'},
      {key: 'b', type: 'sell', coin: 'ethereum', symbol: 'ETH', qty: 0.5, rub: 120000, day: '2026-11-21'},
    ],
  };
  const html = view.portfolio({...s, portfolioTab: 'history'});
  assert.match(html, /Мой портфель/);
  assert.match(html, /История операций/);
  assert.match(html, /Продажа/);
  assert.match(html, /Курс ЦБ: 1 \$ = 80 ₽/);
  assert.match(html, /Реализованная прибыль/);
});

test('transaction form has RUB amount, crypto amount and buy/sell switch', () => {
  const buy = view.buyForm({...base});
  assert.match(buy, /id="tx-form"/);
  assert.match(buy, /name="rub"/);
  assert.match(buy, /name="qty"/);
  assert.match(buy, /name="type" value="buy"/);
  const sell = view.buyForm({...base, txType: 'sell'});
  assert.match(sell, /name="type" value="sell"/);
  assert.match(sell, /Сумма, ₽/);
  assert.match(sell, /Доступно:/);
  assert.match(sell, /name="fee"/);
});

test('transaction form edits an existing operation and keeps its coin', () => {
  const tx = {key: 'edit-me', type: 'sell', coin: 'ethereum', symbol: 'ETH', qty: 0.25, rub: 50000, fee: 250, day: '2026-11-20', note: 'тест', seq: 7};
  const html = view.buyForm({...base, txs: [tx], editTx: 'edit-me', txType: 'sell', buyCoin: 'ethereum'});
  assert.match(html, /Редактировать операцию/);
  assert.match(html, /Сохранить изменения/);
  assert.match(html, /value="0\.25"/);
  assert.match(html, /value="50000"/);
  assert.match(html, /value="250"/);
  assert.match(html, /value="тест"/);
  assert.match(html, /Отмена/);
});

test('portfolio exposes export and import controls', () => {
  const html = view.portfolio({...base});
  assert.match(html, /Экспорт/);
  assert.match(html, /Импорт/);
  const importing = view.portfolio({...base, importTxs: [{key: 'x'}], importSkipped: 1});
  assert.match(importing, /Импорт портфеля/);
  assert.match(importing, /Найдено операций: 1/);
  assert.match(importing, /пропущено 1/);
  assert.match(importing, /Заменить портфель/);
  assert.match(importing, /Добавить к текущему/);
});

test('research page shows installed version and GitHub releases link', () => {
  const html = view.research({...base});
  assert.match(html, /Установлено: 0\.7\.1/);
  assert.match(html, /Открыть GitHub Releases/);
  assert.match(html, /Обновить приложение/);
  assert.match(html, /Только проверить/);
});

test('coin chart renders Japanese candlesticks with OHLC titles', () => {
  const rows = [
    {day: '2026-01-01', open: 100, high: 112, low: 95, close: 108, ma50: 101, ma200: 99},
    {day: '2026-01-02', open: 108, high: 111, low: 102, close: 104, ma50: 102, ma200: 100},
    {day: '2026-01-03', open: 104, high: 118, low: 103, close: 116, ma50: 104, ma200: 101},
  ];
  const html = view.chart(rows);
  assert.match(html, /Японские свечи/);
  assert.match(html, /<rect/);
  assert.match(html, /O 100/);
  assert.match(html, /Рост/);
  assert.match(html, /Падение/);
});

test('custom CoinGecko coin appears in the transaction form and portfolio', () => {
  const pepe = {id: 'pepe', symbol: 'PEPE', name: 'Pepe', price: 0.00001, at: 1, rank: 9999, cap: 0};
  const s = {...base, extras: [pepe], coinUniverse: [...base.coins, pepe], txs: [
    {key: 'p', type: 'buy', coin: 'pepe', symbol: 'PEPE', qty: 1000000, rub: 800, day: '2026-11-20', seq: 1},
  ]};
  const form = view.buyForm({...s, buyCoin: 'pepe'});
  assert.match(form, /PEPE · Pepe/);
  assert.match(form, /Найти в CoinGecko/);
  const html = view.portfolio(s);
  assert.match(html, /PEPE/);
  assert.doesNotMatch(html, /data-act="coin" data-id="pepe"/);
});

test('coin search results render pick buttons', () => {
  const html = view.coinSearchResults({searchResults: [{id: 'pepe', symbol: 'PEPE', name: 'Pepe', rank: 52}]});
  assert.match(html, /data-act="pickcoin" data-id="pepe"/);
  assert.match(html, /PEPE/);
  assert.match(html, /Pepe/);
});

test('portfolio value chart draws value and invested lines', () => {
  const html = view.portfolio({...base, txs: [
    {key: 'a', type: 'buy', coin: 'ethereum', symbol: 'ETH', qty: 1, rub: 200000, day: '2026-11-20', seq: 1},
  ], chartSeries: {complete: true, series: [
    {day: '2026-11-20', value: 200000, invested: 200000},
    {day: '2026-11-21', value: 220000, invested: 200000},
    {day: '2026-11-22', value: 210000, invested: 200000},
  ]}});
  assert.match(html, /Динамика/);
  assert.match(html, /Чистые вложения/);
  assert.match(html, /Стоимость/);
  assert.match(html, /chartrange/);
});


test('portfolio alerts panel shows targets and permission controls', () => {
  const html = view.portfolio({...base, portfolioTab: 'alerts', notifEnabled: false, alerts: [
    {key: 'a', coin: 'bitcoin', symbol: 'BTC', above: true, targetUsd: 100000, targetRub: 8000000, currency: 'rub', enabled: true, targetLabel: '8 000 000 ₽'},
  ]});
  assert.match(html, /Уведомления о цене/);
  assert.match(html, /BTC ≥/);
  assert.match(html, /Разрешить уведомления/);
  assert.match(html, /id="alert-form"/);
  assert.match(html, /Удалить/);
});
