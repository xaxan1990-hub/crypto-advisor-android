import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyToTxs, availableAt, summarize, txRub, txFee, parseBackup, buildBackup, mergeTxs} from '../app/src/main/assets/portfolio.js';

const rate = 80;
const coins = [{id: 'eth', price: 2250}]; // 2250 USD * 80 = 180000 RUB

test('RUB buy/sell keeps exact cash flow and average-cost P&L', () => {
  const txs = [
    {key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01'},
    {key: 'b', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 200000, day: '2026-01-02'},
    {key: 'c', type: 'sell', coin: 'eth', symbol: 'ETH', qty: 0.5, rub: 90000, day: '2026-01-03'},
  ];
  const sum = summarize(txs, coins, rate);
  assert.equal(sum.totalBuy, 300000);
  assert.equal(sum.totalSell, 90000);
  assert.equal(sum.realized, 15000); // 90000 - 75000 average cost
  assert.equal(sum.holdings[0].qty, 1.5);
  assert.equal(sum.holdings[0].cost, 225000);
  assert.equal(sum.holdings[0].value, 270000);
  assert.equal(sum.unrealized, 45000);
  assert.equal(sum.total, 60000);
  assert.equal(sum.complete, true);
});

test('RUB and legacy USD transactions can coexist', () => {
  const legacy = legacyToTxs([{key: 'old', coin: 'eth', symbol: 'ETH', qty: 2, price: 50, day: '2026-01-01'}], rate);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].rub, 8000);
  assert.equal(txRub(legacy[0], rate), 8000);
  const unrated = legacyToTxs([{key: 'old2', coin: 'eth', symbol: 'ETH', qty: 2, price: 50, day: '2026-01-01'}], null);
  assert.equal(txRub(unrated[0], rate), 8000); // fallback conversion when the legacy record has no RUB yet
  const sum = summarize([...legacy, {key: 'new', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-02'}], coins, rate);
  assert.equal(sum.totalBuy, 108000);
  assert.equal(sum.holdings[0].qty, 3);
});

test('availability on a date includes earlier buys and sells only', () => {
  const txs = [
    {key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01'},
    {key: 'b', type: 'sell', coin: 'eth', symbol: 'ETH', qty: 0.4, rub: 80000, day: '2026-01-02'},
  ];
  assert.equal(availableAt(txs, 'eth', '2026-01-01'), 1);
  assert.equal(availableAt(txs, 'eth', '2026-01-02'), 0.6);
  assert.equal(availableAt(txs, 'eth', '2026-01-03'), 0.6);
});

test('oversell is capped and reported', () => {
  const txs = [
    {key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01'},
    {key: 'b', type: 'sell', coin: 'eth', symbol: 'ETH', qty: 2, rub: 200000, day: '2026-01-02'},
  ];
  const sum = summarize(txs, coins, rate);
  assert.equal(sum.holdings.length, 0);
  assert.equal(sum.totalSell, 100000); // half of the entered proceeds was actually backed by holdings
  assert.equal(sum.oversold, 1);
});

test('missing current price marks the total as incomplete', () => {
  const txs = [{key: 'a', type: 'buy', coin: 'missing', symbol: 'MISS', qty: 1, rub: 100000, day: '2026-01-01'}];
  const sum = summarize(txs, coins, rate);
  assert.equal(sum.complete, false);
  assert.equal(sum.value, null);
  assert.equal(sum.holdings[0].value, null);
});

test('fees increase buy cost and reduce sell proceeds', () => {
  const txs = [
    {key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, fee: 1000, day: '2026-01-01'},
    {key: 'b', type: 'sell', coin: 'eth', symbol: 'ETH', qty: 0.5, rub: 60000, fee: 500, day: '2026-01-02'},
  ];
  const sum = summarize(txs, coins, rate);
  assert.equal(txFee(txs[0]), 1000);
  assert.equal(sum.totalBuy, 101000);
  assert.equal(sum.totalSell, 59500);
  assert.equal(sum.fees, 1500);
  assert.equal(sum.realized, 9000); // 59500 - 50500
  assert.equal(sum.holdings[0].qty, 0.5);
  assert.equal(sum.holdings[0].cost, 50500);
});

test('same-day operations follow seq instead of random keys', () => {
  const txs = [
    {key: 'zzz', type: 'sell', coin: 'eth', symbol: 'ETH', qty: 1, rub: 200000, day: '2026-01-01', seq: 2},
    {key: 'aaa', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01', seq: 1},
  ];
  const sum = summarize(txs, coins, rate);
  assert.equal(sum.oversold, 0);
  assert.equal(sum.realized, 100000);
  assert.equal(sum.holdings.length, 0);
});

test('backup round-trip keeps transactions and fees', () => {
  const txs = [
    {key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, fee: 500, day: '2026-01-01', seq: 1, note: 'первая'},
    {key: 'b', type: 'sell', coin: 'eth', symbol: 'ETH', qty: 0.5, rub: 60000, fee: 100, day: '2026-01-02', seq: 2},
  ];
  const parsed = parseBackup(buildBackup(txs, 'rub'));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.txs.length, 2);
  assert.equal(parsed.txs[0].fee, 500);
  assert.equal(parsed.txs[1].note, '');
  assert.equal(parsed.currency, 'rub');
});

test('import rejects broken data and skips invalid rows', () => {
  assert.match(parseBackup('not json').error, /JSON/);
  assert.match(parseBackup('{"transactions":"no"}').error, /списк/);
  const parsed = parseBackup(JSON.stringify({transactions: [
    {type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01'},
    {type: 'sell', coin: 'eth', qty: 0, rub: 10, day: '2026-01-01'},
    {type: 'wat', coin: 'eth', qty: 1, rub: 10, day: '2026-01-01'},
  ]}));
  assert.equal(parsed.txs.length, 1);
  assert.equal(parsed.skipped, 2);
});

test('merge adds new entries and avoids duplicate keys', () => {
  const current = [{key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01', seq: 3}];
  const incoming = [
    {key: 'a', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-01', seq: 1},
    {key: 'b', type: 'buy', coin: 'eth', symbol: 'ETH', qty: 1, rub: 100000, day: '2026-01-02', seq: 2},
  ];
  const merged = mergeTxs(current, incoming);
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map(t => t.key)).size, 2);
  assert.ok(merged[1].seq > current[0].seq);
});
