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

export function txFee(tx) {
    const fee = Number(tx?.fee);
    return finite(fee) && fee > 0 ? fee : 0;
}

export function txPriceRub(tx, rate) {
    const rub = txRub(tx, rate);
    const qty = Number(tx.qty);
    return finite(rub) && finite(qty) && qty > 0 ? rub / qty : null;
}

const seqOf = tx => {
    const n = Number(tx?.seq);
    return finite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
};

export function sortTxs(txs) {
    return txs.slice().sort((a, b) =>
        String(a.day).localeCompare(String(b.day)) ||
        seqOf(a) - seqOf(b) ||
        String(a.key).localeCompare(String(b.key)));
}

export function nextSeq(txs) {
    let max = 0;
    for (const tx of txs) {
        const n = Number(tx?.seq);
        if (finite(n) && n > max) max = n;
    }
    return max + 1;
}

export function normalizeTxs(txs) {
    if (!Array.isArray(txs)) return [];
    return txs.map((tx, i) => {
        if (!tx || typeof tx !== 'object') return tx;
        const seq = Number(tx.seq);
        return finite(seq) && seq > 0 ? tx : {...tx, seq: i + 1};
    });
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
            fee: 0,
            day: buy.day,
            note: buy.note || '',
            legacy: true,
            seq: out.length + 1,
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
    let totalBuy = 0, totalSell = 0, fees = 0, realized = 0, invalid = 0, oversold = 0;

    for (const tx of sortTxs(txs)) {
        const qty = Number(tx.qty);
        const rub = txRub(tx, rate);
        const fee = txFee(tx);
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
            const share = soldQty / qty;
            const netSold = rub * share - fee * share;
            const avg = p.qty > 0 ? p.cost / p.qty : 0;
            const costSold = avg * soldQty;
            p.qty -= soldQty;
            p.cost -= costSold;
            p.realized += netSold - costSold;
            p.sell += netSold;
            totalSell += netSold;
            realized += netSold - costSold;
            fees += fee * share;
            if (soldQty + 1e-9 < qty) oversold++;
        } else {
            p.qty += qty;
            p.cost += rub + fee;
            p.buy += rub + fee;
            totalBuy += rub + fee;
            fees += fee;
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
        fees,
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

export function buildBackup(txs, currency = 'rub') {
    return JSON.stringify({
        app: 'crypto-advisor-android',
        format: 2,
        exportedAt: new Date().toISOString(),
        currency: currency === 'usd' ? 'usd' : 'rub',
        transactions: sortTxs(normalizeTxs(txs)),
    }, null, 2);
}

function parseTx(raw, fallbackSeq) {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type === 'sell' ? 'sell' : raw.type === 'buy' ? 'buy' : null;
    const coin = typeof raw.coin === 'string' ? raw.coin.trim() : '';
    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim() : '';
    const day = String(raw.day || '');
    const qty = Number(raw.qty);
    const rubRaw = raw.rub;
    const rub = rubRaw === null || rubRaw === undefined || rubRaw === '' ? null : Number(rubRaw);
    const priceRaw = raw.priceUsd;
    const priceUsd = priceRaw === null || priceRaw === undefined || priceRaw === '' ? null : Number(priceRaw);
    const feeRaw = raw.fee;
    const fee = feeRaw === null || feeRaw === undefined || feeRaw === '' ? 0 : Number(feeRaw);
    if (!type || !coin || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    if (!finite(qty) || qty <= 0) return null;
    if (!(finite(rub) && rub >= 0) && !(finite(priceUsd) && priceUsd >= 0)) return null;
    if (!finite(fee) || fee < 0) return null;
    const seq = finite(Number(raw.seq)) && Number(raw.seq) > 0 ? Number(raw.seq) : fallbackSeq;
    return {
        key: typeof raw.key === 'string' && raw.key ? raw.key : makeKey(),
        type,
        coin,
        symbol: symbol || coin,
        qty,
        rub: finite(rub) ? rub : null,
        priceUsd: finite(priceUsd) ? priceUsd : null,
        fee,
        day,
        note: typeof raw.note === 'string' ? raw.note.slice(0, 160) : '',
        seq,
        ...(raw.legacy ? {legacy: true} : {}),
        ...(raw.rateDate ? {rateDate: String(raw.rateDate).slice(0, 10)} : {}),
        ...(raw.fxApprox ? {fxApprox: true} : {}),
    };
}

export function parseBackup(text) {
    let data;
    try {
        data = JSON.parse(String(text));
    } catch {
        return {error: 'Файл не является корректным JSON.'};
    }
    const list = Array.isArray(data) ? data : data?.transactions ?? data?.txs;
    if (!Array.isArray(list)) return {error: 'В файле нет списка операций.'};
    if (list.length > 10000) return {error: 'Слишком много операций: максимум 10 000.'};
    const txs = [];
    let skipped = 0;
    list.forEach((raw, i) => {
        const tx = parseTx(raw, i + 1);
        if (tx) txs.push(tx);
        else skipped++;
    });
    if (!txs.length) {
        return {error: list.length ? 'Не удалось прочитать ни одной операции.' : 'Файл не содержит операций.'};
    }
    const currency = data?.currency === 'usd' ? 'usd' : data?.currency === 'rub' ? 'rub' : null;
    return {txs, skipped, currency, exportedAt: typeof data?.exportedAt === 'string' ? data.exportedAt : null};
}

export function mergeTxs(current, incoming) {
    const exists = new Set(current.map(t => t.key));
    const merged = current.slice();
    let seq = nextSeq(current);
    for (const tx of incoming) {
        if (tx.key && exists.has(tx.key)) continue;
        let key = tx.key;
        if (!key) {
            do { key = makeKey(); } while (exists.has(key));
        }
        exists.add(key);
        merged.push({...tx, key, seq: seq++});
    }
    return merged;
}
