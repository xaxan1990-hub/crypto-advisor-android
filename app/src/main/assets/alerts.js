import {finite} from './analysis.js';

export function normalizeAlerts(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(a => a && typeof a.coin === 'string' && a.coin).map((a, i) => ({
        key: String(a.key || ('alert-' + i + '-' + a.coin)),
        coin: a.coin,
        symbol: String(a.symbol || a.coin).toUpperCase(),
        above: a.above !== false,
        targetUsd: Number(a.targetUsd),
        targetRub: finite(Number(a.targetRub)) ? Number(a.targetRub) : null,
        currency: a.currency === 'usd' ? 'usd' : 'rub',
        enabled: a.enabled !== false,
        triggeredAt: Number(a.triggeredAt) || null,
        createdAt: Number(a.createdAt) || Date.now(),
        targetLabel: typeof a.targetLabel === 'string' ? a.targetLabel.slice(0, 80) : '',
    })).filter(a => finite(a.targetUsd) && a.targetUsd > 0);
}

export function alertMatches(alert, price) {
    if (!alert?.enabled || !finite(price) || price <= 0 || !finite(alert.targetUsd)) return false;
    return alert.above ? price >= alert.targetUsd : price <= alert.targetUsd;
}
