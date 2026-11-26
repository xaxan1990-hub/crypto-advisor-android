import test from 'node:test';
import assert from 'node:assert/strict';
import {fxRate, latestRelease} from '../app/src/main/assets/data.js';

const originalFetch = globalThis.fetch;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
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
