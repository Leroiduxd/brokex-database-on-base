/**
 * Sparkline & Price Statistics Calculator
 *
 * Generates compact price summary snapshots including:
 *  - 1h, 24h, 7d, 30d decimal percentage changes
 *  - Sparkline array of recent sampled close prices
 *
 * Saves the latest snapshot to data/sparkline.json (or data/chart/<symbol>/sparkline.json)
 * and keeps only the latest calculated state without history accumulation.
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.resolve(__dirname, '../data');
const SPARKLINE_FILE = path.join(DATA_DIR, 'sparkline.json');

/**
 * Finds the closest candle at or before a target timestamp.
 */
function findCandleAtTime(candles, targetTime) {
    if (!candles || candles.length === 0) return null;
    let closest = candles[0];
    for (let i = candles.length - 1; i >= 0; i--) {
        if (candles[i].time <= targetTime) {
            return candles[i];
        }
    }
    return closest;
}

/**
 * Calculates decimal price difference: (current - previous) / previous
 */
function calculateDiffDecimal(currentPrice, previousPrice) {
    if (!previousPrice || previousPrice === 0 || !currentPrice) return 0;
    const diff = (currentPrice - previousPrice) / previousPrice;
    return Number(diff.toFixed(9));
}

/**
 * Generates an evenly sampled sparkline array of N points from candle history.
 */
function generateSparklinePoints(candles, pointCount = 120) {
    if (!candles || candles.length === 0) return [];
    if (candles.length <= pointCount) {
        return candles.map(c => Number(c.close));
    }

    const points = [];
    const step = (candles.length - 1) / (pointCount - 1);

    for (let i = 0; i < pointCount; i++) {
        const index = Math.round(i * step);
        const candle = candles[Math.min(index, candles.length - 1)];
        points.push(Number(candle.close));
    }

    return points;
}

/**
 * Builds the complete sparkline and statistical diff object for a symbol.
 *
 * @param {string} symbol - Symbol identifier (e.g. Metal.XAU/USD)
 * @param {Array<{time: number, open: number, high: number, low: number, close: number}>} m1Candles - Sorted 1m candles
 * @returns {Object}
 */
function buildSparklineData(symbol, m1Candles) {
    const sym = symbol || process.env.PYTH_SYMBOL || 'Metal.XAU/USD';

    if (!m1Candles || m1Candles.length === 0) {
        return {
            symbol: sym,
            hour_price_diff_decimal: 0,
            day_price_diff_decimal: 0,
            week_price_diff_decimal: 0,
            month_price_diff_decimal: 0,
            sparkline: []
        };
    }

    const latestCandle = m1Candles[m1Candles.length - 1];
    const currentPrice = Number(latestCandle.close);
    const nowTime = latestCandle.time;

    // Time deltas in seconds
    const ONE_HOUR = 3600;
    const ONE_DAY = 86400;
    const ONE_WEEK = 7 * 86400;
    const ONE_MONTH = 30 * 86400;

    const candle1h = findCandleAtTime(m1Candles, nowTime - ONE_HOUR);
    const candle24h = findCandleAtTime(m1Candles, nowTime - ONE_DAY);
    const candle7d = findCandleAtTime(m1Candles, nowTime - ONE_WEEK);
    const candle30d = findCandleAtTime(m1Candles, nowTime - ONE_MONTH);

    // Calculate 24h High, Low, Open, and Stats from 24h candle window
    const window24hStart = nowTime - ONE_DAY;
    const candles24h = m1Candles.filter(c => c.time >= window24hStart);
    const source24h = candles24h.length > 0 ? candles24h : [latestCandle];

    const high24h = Math.max(...source24h.map(c => Number(c.high || c.close)));
    const low24h = Math.min(...source24h.map(c => Number(c.low || c.close)));
    const open24h = Number(source24h[0].open || source24h[0].close);
    const priceChange24h = currentPrice - open24h;
    const priceChangePercent24h = open24h > 0 ? (priceChange24h / open24h) * 100 : 0;

    // Use recent week (or available range) for sparkline
    const sparklineWindowStart = nowTime - ONE_WEEK;
    const recentCandles = m1Candles.filter(c => c.time >= sparklineWindowStart);
    const sparklineSource = recentCandles.length >= 30 ? recentCandles : m1Candles;

    const sparkline = generateSparklinePoints(sparklineSource, 120);

    const result = {
        symbol: sym,
        current_price: currentPrice,
        high_24h: high24h,
        low_24h: low24h,
        open_24h: open24h,
        price_change_24h: Number(priceChange24h.toFixed(4)),
        price_change_percent_24h: Number(priceChangePercent24h.toFixed(3)),
        hour_price_diff_decimal: calculateDiffDecimal(currentPrice, candle1h ? candle1h.close : currentPrice),
        day_price_diff_decimal: calculateDiffDecimal(currentPrice, candle24h ? candle24h.close : currentPrice),
        week_price_diff_decimal: calculateDiffDecimal(currentPrice, candle7d ? candle7d.close : currentPrice),
        month_price_diff_decimal: calculateDiffDecimal(currentPrice, candle30d ? candle30d.close : currentPrice),
        sparkline
    };

    return result;
}

/**
 * Saves the latest sparkline snapshot to file.
 */
function saveSparklineData(symbol, sparklineData) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Save global latest snapshot (overwrites file)
    fs.writeFileSync(SPARKLINE_FILE, JSON.stringify(sparklineData, null, 2), 'utf8');

    // Also save under symbol folder
    const symbolDir = path.join(DATA_DIR, 'chart', symbol.replace(/\//g, '_'));
    if (!fs.existsSync(symbolDir)) {
        fs.mkdirSync(symbolDir, { recursive: true });
    }
    fs.writeFileSync(path.join(symbolDir, 'sparkline.json'), JSON.stringify(sparklineData, null, 2), 'utf8');

    return sparklineData;
}

function getLatestSparklineData() {
    if (fs.existsSync(SPARKLINE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SPARKLINE_FILE, 'utf8'));
        } catch {
            return null;
        }
    }
    return null;
}

module.exports = {
    buildSparklineData,
    saveSparklineData,
    getLatestSparklineData,
    SPARKLINE_FILE
};
