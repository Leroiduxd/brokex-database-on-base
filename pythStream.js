/**
 * Pyth Real-Time Price Streamer (Server-Sent Events)
 *
 * Connects to the Pyth TradingView Streaming SSE endpoint (https://benchmarks.pyth.network/v1/shims/tradingview/streaming)
 * Filters prices for the symbol configured in .env (PYTH_SYMBOL, e.g. Metal.XAU/USD) or passed as CLI argument,
 * and formats clean terminal output with price, timestamp, and human-readable time.
 */

require('dotenv').config();

const DEFAULT_STREAM_URL = 'https://benchmarks.pyth.network/v1/shims/tradingview/streaming';
const STREAM_URL = process.env.PYTH_STREAMING_URL || DEFAULT_STREAM_URL;

// Target symbol strictly retrieved from process.env.PYTH_SYMBOL or optional CLI override
const TARGET_SYMBOL = process.argv[2] || process.env.PYTH_SYMBOL;

if (!TARGET_SYMBOL) {
    console.error('[ERROR] PYTH_SYMBOL is not defined in .env');
    process.exit(1);
}

let tickCount = 0;
let lastPrice = null;
let lastTimestamp = 0;

function formatPriceChange(current, previous) {
    if (previous === null || previous === undefined) return '';
    const diff = current - previous;
    if (diff > 0) return ` (+${diff.toFixed(4)})`;
    if (diff < 0) return ` (${diff.toFixed(4)})`;
    return ' (=)';
}

async function startPythStream(targetSymbol = TARGET_SYMBOL) {
    if (!targetSymbol) {
        throw new Error('No target symbol provided. Set PYTH_SYMBOL in .env or pass as argument.');
    }
    console.log('='.repeat(80));
    console.log('PYTH REAL-TIME SSE STREAMING FEED');
    console.log(`Endpoint URL   : ${STREAM_URL}`);
    console.log(`Target Symbol  : ${targetSymbol}`);
    console.log('='.repeat(80));

    let retryCount = 0;

    while (true) {
        try {
            console.log(`[CONNECTING] Connecting to Pyth SSE stream...`);
            const response = await fetch(STREAM_URL);

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
            }

            console.log(`[CONNECTED] Stream open. Listening for updates on ${targetSymbol}...\n`);
            retryCount = 0;

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep partial line for next chunk

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // Clean SSE prefixes if any (e.g. "data: {...}")
                    const jsonStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed && parsed.id && parsed.id.toLowerCase() === targetSymbol.toLowerCase()) {
                            const price = Number(parsed.p);
                            const timestampSec = Number(parsed.t);
                            const changeIndicator = formatPriceChange(price, lastPrice);

                            tickCount++;
                            const dateIso = new Date(timestampSec * 1000).toISOString();
                            const priceFormatted = `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

                            console.log(`[#${tickCount.toString().padStart(4, ' ')}] ${dateIso} | ${parsed.id} | Price: ${priceFormatted}${changeIndicator} | Status: ${parsed.s ?? 0}`);

                            lastPrice = price;
                            lastTimestamp = timestampSec;
                        }
                    } catch {
                        // Skip malformed or keepalive chunks
                    }
                }
            }
        } catch (error) {
            retryCount++;
            const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
            console.warn(`[DISCONNECTED] Stream disconnected (${error.message}). Reconnecting in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

if (require.main === module) {
    startPythStream();
}

module.exports = {
    startPythStream
};
