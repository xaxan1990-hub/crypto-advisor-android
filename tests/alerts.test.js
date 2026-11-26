import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAlerts, alertMatches} from '../app/src/main/assets/alerts.js';

test('alerts normalize saved fields and drop invalid targets', () => {
  const list = normalizeAlerts([
    {key: 'a', coin: 'bitcoin', symbol: 'btc', above: true, targetUsd: 100000, targetRub: 8000000, currency: 'rub', enabled: true},
    {key: 'b', coin: 'ethereum', symbol: 'eth', above: false, targetUsd: 0, enabled: true},
    {coin: '', targetUsd: 10},
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'BTC');
  assert.equal(list[0].amount, undefined);
  assert.equal(list[0].targetRub, 8000000);
  assert.equal(list[0].currency, 'rub');
});

test('alert matching respects direction and enabled state', () => {
  const above = {enabled: true, above: true, targetUsd: 100};
  const below = {enabled: true, above: false, targetUsd: 100};
  assert.equal(alertMatches(above, 100), true);
  assert.equal(alertMatches(above, 99.9), false);
  assert.equal(alertMatches(below, 99.9), true);
  assert.equal(alertMatches(below, 100.1), false);
  assert.equal(alertMatches({...above, enabled: false}, 200), false);
  assert.equal(alertMatches(above, NaN), false);
});
