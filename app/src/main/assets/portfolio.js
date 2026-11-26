import {finite} from './analysis.js';

export function makeKey() {
    if (globalThis.crypto?.getRandomValues) {
        return Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function txRub(tx, rate) {
    if (tx.rub !== null && tx.rub !== undefined && tx.rub !== '') {
        const direct = Number(tx.rub);
        if (finite(direct) && direct >= 0) return direct;
    }
    if (finite(tx.priceUsd) && finite(tx.qty) && finite(rate) && rate > 0) {
        return Number(tx.qty) * Number(tx.priceUsd) * rate;
    }
    return null;
}

export function txPriceRub(tx, rate) {
    const rub = txRub(tx, rate);
    const qty = Number(tx.qty);
    return finite(rub) && finite(qty) && qty > 0 ? rub / qty : null;
}

export function sortTxs(txs) {
    return txs.slice().sort((a, b) =>
        String(a.day).localeCompare(String(b.day)) ||
        String(a.key).localeCompare(String(b.key)));
}

export function legacyToTxs(old, rate) {
    const out = [];
    for (const buy of old) {
        const qty = Number(buy.qty), price = Number(buy.price);
        if (!finite(qty) || qty <= 0 || !finite(price) || price < 0 || !buy.day) continue;
        out.push({
            key: buy.key || makeKey(),
            type: 'buy',
            coin: buy.coin,
            symbol: buy.symbol,
            qty,
            rub: finite(rate) && rate > 0 ? qty * price * rate : null,
            priceUsd: price,
            day: buy.day,
            note: buy.note || '',
            legacy: true,
        });
    }
    return out;
}

export function availableAt(txs, coin, day) {
    let qty = 0;
    for (const tx of sortTxs(txs)) {
        if (day && String(tx.day) > String(day)) continue;
        if (tx.coin !== coin) continue;
        const q = Number(tx.qty);
        if (!finite(q) || q <= 0) continue;
        qty += tx.type === 'sell' ? -q : q;
    }
    return Math.max(0, qty);
}

export function summarize(txs, coins, rate) {
    const prices = new Map(coins.map(c => [c.id, c.price]));
    const positions = new Map();
    let totalBuy = 0, totalSell = 0, realized = 0, invalid = 0, oversold = 0;

    for (const tx of sortTxs(txs)) {
        const qty = Number(tx.qty);
        const rub = txRub(tx, rate);
        if (!finite(qty) || qty <= 0 || !finite(rub) || rub < 0) {
            invalid++;
            continue;
        }
        let p = positions.get(tx.coin);
        if (!p) {
            p = {coin: tx.coin, symbol: tx.symbol, qty: 0, cost: 0, realized: 0, buy: 0, sell: 0};
            positions.set(tx.coin, p);
        }
        if (tx.type === 'sell') {
            const soldQty = Math.min(qty, p.qty);
            if (soldQty <= 1e-12) {
                oversold++;
                continue;
            }
            const soldRub = rub * (soldQty / qty);
            const avg = p.qty > 0 ? p.cost / p.qty : 0;
            const costSold = avg * soldQty;
            p.qty -= soldQty;
            p.cost -= costSold;
            p.realized += soldRub - costSold;
            p.sell += soldRub;
            totalSell += soldRub;
            realized += soldRub - costSold;
            if (soldQty + 1e-9 < qty) oversold++;
        } else {
            p.qty += qty;
            p.cost += rub;
            p.buy += rub;
            totalBuy += rub;
        }
    }

    let value = 0, cost = 0, complete = true;
    const holdings = [];
    for (const p of positions.values()) {
        if (p.qty <= 1e-12) continue;
        cost += p.cost;
        const usd = prices.get(p.coin);
        const priceRub = finite(usd) && finite(rate) && rate > 0 ? usd * rate : null;
        const current = priceRub === null ? null : p.qty * priceRub;
        if (current === null) complete = false;
        else value += current;
        const avg = p.qty > 0 ? p.cost / p.qty : null;
        const pl = current === null ? null : current - p.cost;
        const plPct = pl === null || p.cost === 0 ? null : pl / p.cost * 100;
        holdings.push({...p, priceRub, value: current, avg, pl, plPct});
    }

    const totalValue = complete ? value : null;
    const unrealized = totalValue === null ? null : totalValue - cost;
    const total = totalValue === null ? null : totalValue + totalSell - totalBuy;
    return {
        holdings,
        totalBuy,
        totalSell,
        value: totalValue,
        partialValue: value,
        cost,
        realized,
        unrealized,
        total,
        invalid,
        oversold,
        complete,
    };
}
