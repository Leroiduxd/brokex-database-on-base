/**
 * Pyth Asset Price Differences & Variations Service
 * 
 * Fetches price differences (1h, 24h, 7d) from Pyth Benchmarks API
 * for top Forex, Commodities/Metals, Cryptos, and US Equities,
 * strips out heavy sparkline arrays to keep it lightweight,
 * and writes the fresh snapshot into data/marketsSummary.json.
 */

const fs = require('fs');
const path = require('path');

const BENCHMARKS_PRICE_DIFF_URL = 'https://benchmarks.pyth.network/v1/price_differences/';
const OUTPUT_FILE = path.join(__dirname, 'data', 'marketsSummary.json');

// Curated list of major market assets
const TARGET_ASSETS = [
    // --- FOREX ---
    { symbol: 'FX.EUR/USD', name: 'EUR / USD', category: 'forex' },
    { symbol: 'FX.GBP/USD', name: 'GBP / USD', category: 'forex' },
    { symbol: 'FX.USD/JPY', name: 'USD / JPY', category: 'forex' },
    { symbol: 'FX.USD/CHF', name: 'USD / CHF', category: 'forex' },
    { symbol: 'FX.AUD/USD', name: 'AUD / USD', category: 'forex' },
    { symbol: 'FX.USD/CAD', name: 'USD / CAD', category: 'forex' },

    // --- METALS & COMMODITIES ---
    { symbol: 'Metal.XAU/USD', name: 'Gold / USD', category: 'commodities' },
    { symbol: 'Metal.XAG/USD', name: 'Silver / USD', category: 'commodities' },
    { symbol: 'Metal.XPT/USD', name: 'Platinum / USD', category: 'commodities' },
    { symbol: 'Metal.XPD/USD', name: 'Palladium / USD', category: 'commodities' },
    { symbol: 'Commodities.USOILSPOT', name: 'WTI Crude Oil', category: 'commodities' },
    { symbol: 'Commodities.UKOILSPOT', name: 'Brent Crude Oil', category: 'commodities' },

    // --- CRYPTO ---
    { symbol: 'Crypto.BTC/USD', name: 'Bitcoin', category: 'crypto' },
    { symbol: 'Crypto.ETH/USD', name: 'Ethereum', category: 'crypto' },
    { symbol: 'Crypto.SOL/USD', name: 'Solana', category: 'crypto' },
    { symbol: 'Crypto.BNB/USD', name: 'BNB', category: 'crypto' },
    { symbol: 'Crypto.XRP/USD', name: 'XRP', category: 'crypto' },
    { symbol: 'Crypto.DOGE/USD', name: 'Dogecoin', category: 'crypto' },
    { symbol: 'Crypto.AVAX/USD', name: 'Avalanche', category: 'crypto' },

    // --- US EQUITIES ---
    { symbol: 'Equity.US.AAPL/USD', name: 'Apple Inc.', category: 'equities' },
    { symbol: 'Equity.US.TSLA/USD', name: 'Tesla Inc.', category: 'equities' },
    { symbol: 'Equity.US.NVDA/USD', name: 'NVIDIA Corp.', category: 'equities' },
    { symbol: 'Equity.US.MSFT/USD', name: 'Microsoft Corp.', category: 'equities' },
    { symbol: 'Equity.US.AMZN/USD', name: 'Amazon.com Inc.', category: 'equities' },
    { symbol: 'Equity.US.GOOGL/USD', name: 'Alphabet (Google)', category: 'equities' },
    { symbol: 'Equity.US.META/USD', name: 'Meta Platforms', category: 'equities' }
];

async function updateMarketPriceDifferences() {
    try {
        console.log(`[MARKETS] Fetching price differences from Pyth (${BENCHMARKS_PRICE_DIFF_URL})...`);
        
        const response = await fetch(BENCHMARKS_PRICE_DIFF_URL);
        if (!response.ok) {
            throw new Error(`Pyth API HTTP error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
            throw new Error('Invalid response format from Pyth API: expected an array.');
        }

        // Index data by symbol for instant lookup
        const dataBySymbol = new Map();
        for (const item of data) {
            if (item && item.symbol) {
                dataBySymbol.set(item.symbol, item);
            }
        }

        // Map targets without sparklines
        const markets = [];
        for (const target of TARGET_ASSETS) {
            const raw = dataBySymbol.get(target.symbol);
            if (raw) {
                // Calculate current spot from the latest point in sparkline if present, or null
                const latestPrice = Array.isArray(raw.sparkline) && raw.sparkline.length > 0
                    ? raw.sparkline[raw.sparkline.length - 1]
                    : null;

                markets.push({
                    symbol: target.symbol,
                    name: target.name,
                    category: target.category,
                    price: latestPrice,
                    hourChangePercent: typeof raw.hour_price_diff_decimal === 'number' 
                        ? Number((raw.hour_price_diff_decimal * 100).toFixed(4)) 
                        : null,
                    dayChangePercent: typeof raw.day_price_diff_decimal === 'number' 
                        ? Number((raw.day_price_diff_decimal * 100).toFixed(4)) 
                        : null,
                    weekChangePercent: typeof raw.week_price_diff_decimal === 'number' 
                        ? Number((raw.week_price_diff_decimal * 100).toFixed(4)) 
                        : null,
                    rawDiff: {
                        hour: raw.hour_price_diff_decimal,
                        day: raw.day_price_diff_decimal,
                        week: raw.week_price_diff_decimal
                    }
                });
            }
        }

        const outputData = {
            updatedAt: new Date().toISOString(),
            totalAssets: markets.length,
            markets
        };

        // Ensure data directory exists
        const dataDir = path.dirname(OUTPUT_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Atomic write (overwrite previous file)
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf8');
        console.log(`[MARKETS] Successfully updated ${markets.length} market summaries in: ${OUTPUT_FILE}`);
        return outputData;
    } catch (err) {
        console.error(`[MARKETS] Error updating market price differences: ${err.message}`);
        throw err;
    }
}

// CLI Execution
if (require.main === module) {
    updateMarketPriceDifferences()
        .then((res) => {
            console.log('\nSample results:');
            console.log(res.markets.slice(0, 5));
        })
        .catch(() => process.exit(1));
}

module.exports = {
    updateMarketPriceDifferences,
    TARGET_ASSETS
};
