import test from 'node:test';
import assert from 'node:assert/strict';
import {fxRate, fxRateForDay, searchCoins, extraPrices, latestRelease} from '../app/src/main/assets/data.js';

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

test('CBR USD/RUB feed is parsed into a rate with date and source', async () => {
  globalThis.fetch = async () => jsonResponse({
    at: 0,
    data: {
      Date: '2026-11-27T11:30:00+03:00',
      Valute: {USD: {Nominal: 1, Value: 82.1265}},
    },
  });
  const fx = await fxRate();
  assert.equal(fx.rate, 82.1265);
  assert.equal(fx.date, '2026-11-27');
  assert.equal(fx.source, 'ЦБ РФ');
  assert.equal(fx.stale, false);
});

test('USDT/RUB is used as a fallback when CBR fails', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? jsonResponse({error: 'down'}, 503) : jsonResponse({at: 0, data: {tether: {rub: 81.9}}});
  };
  const fx = await fxRate();
  assert.equal(fx.rate, 81.9);
  assert.equal(fx.source, 'USDT/RUB');
});

test('latest GitHub release exposes tag and page URL', async () => {
  globalThis.fetch = async () => jsonResponse({
    at: 0,
    data: {tag_name: 'v0.2.0', html_url: 'https://github.com/xaxan1990-hub/crypto-advisor-android/releases/tag/v0.2.0'},
  });
  const release = await latestRelease();
  assert.equal(release.tag, 'v0.2.0');
  assert.match(release.url, /releases\/tag\/v0\.2\.0$/);
});


test('historical CBR rate falls back to the previous business day and is cached', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  let calls = 0;
  globalThis.fetch = async input => {
    calls++;
    const date = new URL(input, 'http://app').searchParams.get('id');
    if (date === '2026-11-22' || date === '2026-11-21') return jsonResponse({error: 'weekend'}, 503);
    return jsonResponse({at: 0, data: {
      Date: '2026-11-20T11:30:00+03:00',
      Valute: {USD: {Nominal: 1, Value: 81.929}},
    }});
  };
  const first = await fxRateForDay('2026-11-22');
  assert.equal(first.rate, 81.929);
  assert.equal(first.date, '2026-11-20');
  assert.equal(calls, 3);
  calls = 0;
  const second = await fxRateForDay('2026-11-22');
  assert.equal(second.rate, 81.929);
  assert.equal(calls, 0);
});

test('CoinGecko search and simple price responses are mapped', async () => {
  globalThis.fetch = async input => {
    const uri = new URL(input, 'http://app');
    if (uri.pathname.endsWith('/search')) return jsonResponse({at: 0, data: {coins: [
      {id: 'pepe', symbol: 'pepe', name: 'Pepe', market_cap_rank: 52},
    ]}});
    return jsonResponse({at: 0, data: {pepe: {usd: 0.00001, last_updated_at: 1795732237}}});
  };
  const found = await searchCoins('pepe');
  assert.deepEqual(found, [{id: 'pepe', symbol: 'PEPE', name: 'Pepe', rank: 52}]);
  const prices = await extraPrices(['pepe']);
  assert.equal(prices.get('pepe').price, 0.00001);
  assert.equal(prices.get('pepe').at, 1795732237000);
});
