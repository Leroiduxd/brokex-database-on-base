/**
 * ==============================================================================
 * BROKEX PUBLIC REST & SSE API SERVER (`server.js`)
 * ==============================================================================
 *
 * Provides a lightweight, high-performance HTTP / SSE public API for Brokex:
 *
 * 🌐 PUBLIC ENDPOINTS:
 * 1. GET /                    : Interactive Swagger-style HTML Documentation
 * 2. GET /stream              : Real-Time SSE (Server-Sent Events) Price Stream (Proxy from Pyth)
 * 3. GET /oracle              : Real-Time Pyth Oracle Price & Metadata (with 1s cache)
 * 4. GET /proof               : Pyth Hermes v2 Cryptographic Binary Proof (`bytes[]`)
 * 5. GET /protocol-info       : Latest Protocol state & stats (BrokexLens snapshot)
 * 6. GET /trader/:address     : All trades and positions for a specific trader
 * 7. GET /chart/history       : Candlestick chart history (?from=...&to=...&resolution=1)
 * 8. GET /chart/sparkline     : 1h/24h/7d/30d variations & 120-pt price sparkline
 * 9. GET /chart/24h           : 24h High, 24h Low, price changes & sparkline
 * 10. GET /liquidations       : Liquidation prices and borrow fees for all open trades
 * 11. GET /average-prices     : Weighted average open prices for LONG and SHORT positions
 * 12. GET /borrow-index       : Weighted average borrow index & accrued borrow interest
 * 13. GET /referrals/:address : Referral profile & rewards
 * 14. GET /volume/:address    : Cumulative volume profile
 *
 * Accepts query param ?network=testnet|mainnet or headers for on-demand network switching!
 * ==============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { getNetworkConfig } = require('./config');
const { getPythProof } = require('./getPythProof');
const { getTradesByTrader } = require('./getTraderTrades');
const { getRecentTrades, updateTradesDatabase, getTradeById } = require('./tradeService');
const { getReferralInfo } = require('./referralService');
const { getTraderVolume } = require('./volumeService');
const { calculateOpenTradesLiquidation } = require('./getLiquidationPrices');
const { calculateAverageOpenPrices } = require('./getAverageOpenPrices');
const { calculateWeightedAverageBorrowIndex } = require('./getAverageBorrowIndex');
const { updateProtocolInfo } = require('./lensService');
const { buildSparklineData, saveSparklineData } = require('./chart/sparklineService');
const pythService = require('./chart/pythService');
const storageService = require('./chart/storageService');

const PORT = process.env.PORT || 3000;
const config = getNetworkConfig();

const STREAM_URL = config.pythStreamingUrl;
const TARGET_SYMBOL = config.pythSymbol;

// Active connected SSE clients
const sseClients = new Set();
let pythStreamActive = false;

function extractNetwork(req, query) {
    if (query && (query.network === 'mainnet' || query.network === 'testnet')) {
        return query.network;
    }
    const headerNet = req.headers['x-network'];
    if (headerNet === 'mainnet' || headerNet === 'testnet') {
        return headerNet;
    }
    return config.network;
}

/**
 * Connects to Pyth SSE stream once and multiplexes to all connected API clients.
 */
function initSseRelay() {
    if (pythStreamActive) return;
    pythStreamActive = true;

    console.log(`[SSE RELAY] Opening Pyth SSE stream from ${STREAM_URL}...`);

    const startStream = async () => {
        let retryDelay = 2000;
        while (true) {
            try {
                const response = await fetch(STREAM_URL);
                if (!response.ok) {
                    throw new Error(`Pyth SSE returned HTTP ${response.status}`);
                }

                console.log(`[SSE RELAY] Connected to Pyth upstream. Relaying ticks for ${TARGET_SYMBOL}...`);
                retryDelay = 2000;

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data:')) continue;

                        const jsonStr = trimmed.slice(5).trim();
                        if (!jsonStr) continue;

                        try {
                            const payload = JSON.parse(jsonStr);
                            if (payload.id === TARGET_SYMBOL && payload.p !== undefined) {
                                const ssePayload = `data: ${JSON.stringify({
                                    symbol: TARGET_SYMBOL,
                                    price: Number(payload.p),
                                    timestamp: payload.t || Math.floor(Date.now() / 1000),
                                    iso: new Date((payload.t || Math.floor(Date.now() / 1000)) * 1000).toISOString()
                                })}\n\n`;

                                for (const client of sseClients) {
                                    try {
                                        client.write(ssePayload);
                                    } catch {
                                        sseClients.delete(client);
                                    }
                                }
                            }
                        } catch {}
                    }
                }
            } catch (err) {
                console.warn(`[SSE RELAY] Stream error: ${err.message}. Retrying in ${retryDelay / 1000}s...`);
                await new Promise(r => setTimeout(r, retryDelay));
                retryDelay = Math.min(retryDelay * 1.5, 30000);
            }
        }
    };

    startStream().catch(err => {
        console.error(`[SSE RELAY FATAL] ${err.message}`);
        pythStreamActive = false;
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-network'
    });
    res.end(JSON.stringify(data, null, 2));
}

function renderDocumentationHtml(req) {
    const host = req.headers.host || `localhost:${PORT}`;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${protocol}://${host}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brokex Public API Documentation</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #05070a;
            --surface: #0a0d14;
            --surface-hover: #0f131d;
            --border: #151b26;
            --border-hover: #1e2638;
            --text-primary: #f0f6fc;
            --text-secondary: #949eb0;
            --text-muted: #5e697d;
            --accent: #d97706;
            --accent-gold: #f59e0b;
            --accent-bg: rgba(245, 158, 11, 0.08);
            --get-color: #10b981;
            --get-bg: rgba(16, 185, 129, 0.08);
            --radius: 8px;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg);
            color: var(--text-primary);
            line-height: 1.5;
            padding: 40px 20px;
        }

        .container {
            max-width: 960px;
            margin: 0 auto;
        }

        header {
            border-bottom: 1px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 32px;
        }

        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 12px;
        }

        h1 {
            font-size: 22px;
            font-weight: 600;
            letter-spacing: -0.02em;
            color: #ffffff;
        }

        .base-url {
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            color: var(--text-secondary);
            background: var(--surface);
            padding: 4px 10px;
            border-radius: 4px;
            border: 1px solid var(--border);
        }

        .description {
            color: var(--text-secondary);
            font-size: 14px;
            max-width: 720px;
        }

        .section-heading {
            font-size: 13px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            color: var(--text-muted);
            margin: 36px 0 16px 0;
        }

        .endpoints-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .endpoint-card {
            background-color: var(--surface);
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
            transition: border-color 0.15s ease;
        }

        .endpoint-card:hover {
            border-color: #30363d;
        }

        .endpoint-header {
            padding: 14px 18px;
            display: flex;
            align-items: center;
            gap: 14px;
            background: rgba(255, 255, 255, 0.01);
            border-bottom: 1px solid var(--border);
            flex-wrap: wrap;
        }

        .method {
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            font-weight: 600;
            padding: 3px 6px;
            border-radius: 4px;
            text-transform: uppercase;
        }

        .method.get {
            background: var(--get-bg);
            color: var(--get-color);
            border: 1px solid rgba(63, 185, 80, 0.3);
        }

        .path {
            font-family: 'JetBrains Mono', monospace;
            font-size: 14px;
            font-weight: 500;
            color: #ffffff;
        }

        .summary {
            font-size: 13px;
            color: var(--text-secondary);
            margin-left: auto;
        }

        .endpoint-content {
            padding: 18px;
            font-size: 13px;
        }

        .endpoint-content p {
            color: var(--text-secondary);
            margin-bottom: 14px;
        }

        .code-container {
            background-color: var(--bg);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 12px 14px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: #d1d7e0;
            overflow-x: auto;
            position: relative;
            margin-bottom: 12px;
        }

        .actions {
            display: flex;
            gap: 10px;
        }

        .btn-test {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background-color: var(--accent-bg);
            color: var(--accent);
            border: 1px solid rgba(88, 166, 255, 0.3);
            border-radius: 4px;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 500;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .btn-test:hover {
            background-color: rgba(88, 166, 255, 0.2);
            border-color: var(--accent);
        }

        footer {
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--text-muted);
        }

        footer a {
            color: var(--text-secondary);
            text-decoration: none;
        }

        footer a:hover {
            color: var(--accent);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-top">
                <h1>Brokex Public API (Multi-Network Ready)</h1>
                <div class="base-url">${baseUrl}</div>
            </div>
            <div class="description">
                High-performance REST and SSE endpoints for Brokex Protocol. Supports Base Sepolia (Testnet) and Base (Mainnet) via <code>?network=testnet|mainnet</code>.
            </div>
        </header>

        <div class="section-heading">Oracle & Real-Time Price Streams</div>
        <div class="endpoints-list">
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/stream</span>
                    <span class="summary">SSE Live Price Stream</span>
                </div>
                <div class="endpoint-content">
                    <p>Subscribes to live price updates for Gold (XAU/USD).</p>
                    <div class="code-container">curl -N "${baseUrl}/stream"</div>
                    <div class="actions">
                        <a class="btn-test" href="/stream" target="_blank">Open stream →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/oracle</span>
                    <span class="summary">Current Oracle Spot Price</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns live Pyth spot price.</p>
                    <div class="code-container">curl "${baseUrl}/oracle"</div>
                    <div class="actions">
                        <a class="btn-test" href="/oracle" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/proof</span>
                    <span class="summary">Pyth Hermes v2 Binary Proof</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns latest signed binary price update data for execution.</p>
                    <div class="code-container">curl "${baseUrl}/proof"</div>
                    <div class="actions">
                        <a class="btn-test" href="/proof" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-heading">Protocol & Trades</div>
        <div class="endpoints-list">
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/trader/:address</span>
                    <span class="summary">Trader Portfolio & History</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns all open, closed, created and cancelled trades for a trader address, including transactions and events history.</p>
                    <div class="code-container">curl "${baseUrl}/trader/0xca30CD2760E48af1Be32C8420e71803DA6735142"</div>
                    <div class="actions">
                        <a class="btn-test" href="/trader/0xca30CD2760E48af1Be32C8420e71803DA6735142" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/trade/:id</span>
                    <span class="summary">Single Trade Full Details & Audit Trail</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns full details for a specific trade (creationTxHash, openingTxHash, closingTxHash, all txHashes & event audit trail).</p>
                    <div class="code-container">curl "${baseUrl}/trade/1"</div>
                    <div class="actions">
                        <a class="btn-test" href="/trade/1" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/protocol-info</span>
                    <span class="summary">Protocol Global Stats</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns latest Lens snapshot (?network=testnet|mainnet).</p>
                    <div class="code-container">curl "${baseUrl}/protocol-info?network=testnet"</div>
                    <div class="actions">
                        <a class="btn-test" href="/protocol-info" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/liquidations</span>
                    <span class="summary">Open Positions & Liquidations</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns exact calculated liquidation prices for open trades.</p>
                    <div class="code-container">curl "${baseUrl}/liquidations"</div>
                    <div class="actions">
                        <a class="btn-test" href="/liquidations" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/average-prices</span>
                    <span class="summary">Weighted Average Open Prices</span>
                </div>
                <div class="endpoint-content">
                    <p>Calculates weighted average open prices for Long and Short.</p>
                    <div class="code-container">curl "${baseUrl}/average-prices"</div>
                    <div class="actions">
                        <a class="btn-test" href="/average-prices" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>
        </div>

        <div class="section-heading">Chart & Market Data</div>
        <div class="endpoints-list">
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/markets</span>
                    <span class="summary">Multi-Asset Market Variations & Prices</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns 1h, 24h and 7d percentage variations and spot prices for Top Forex, Metals (Gold, Silver, Platinum), Commodities (Crude Oil), Cryptos (BTC, ETH, SOL...) and US Equities (AAPL, TSLA, NVDA...).</p>
                    <div class="code-container">curl "${baseUrl}/markets"</div>
                    <div class="actions">
                        <a class="btn-test" href="/markets" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/markets/refresh</span>
                    <span class="summary">Force Refresh Pyth Market Differences</span>
                </div>
                <div class="endpoint-content">
                    <p>Forces a live re-fetch from Pyth Benchmarks and updates <code>data/marketsSummary.json</code> on disk immediately.</p>
                    <div class="code-container">curl "${baseUrl}/markets/refresh"</div>
                    <div class="actions">
                        <a class="btn-test" href="/markets/refresh" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <span class="method get">GET</span>
                    <span class="path">/chart/24h</span>
                    <span class="summary">24h High, Low & Sparkline</span>
                </div>
                <div class="endpoint-content">
                    <p>Returns 24h lowest price (<code>low_24h</code>), 24h highest price (<code>high_24h</code>), price variations and 120-pt sparkline.</p>
                    <div class="code-container">curl "${baseUrl}/chart/24h"</div>
                    <div class="actions">
                        <a class="btn-test" href="/chart/24h" target="_blank">Execute request →</a>
                    </div>
                </div>
            </div>
        </div>

        <footer>
            <span>Active Network: <code>${config.network.toUpperCase()}</code></span>
            <span>Target Asset: <code>${TARGET_SYMBOL}</code></span>
        </footer>
    </div>
</body>
</html>`;
}

/**
 * Main HTTP Request Handler.
 */
const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-network'
        });
        res.end();
        return;
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${host}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    const activeNetwork = extractNetwork(req, query);
    const netConfig = getNetworkConfig(activeNetwork);

    try {
        // ROUTE 1: Docs HTML
        if (pathname === '/' || pathname === '/docs') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(renderDocumentationHtml(req));
            return;
        }

        // ROUTE 2: SSE Real-Time Stream
        if (pathname === '/stream') {
            initSseRelay();
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            res.write(`: connected to brokex price stream for ${TARGET_SYMBOL}\n\n`);
            sseClients.add(res);

            req.on('close', () => {
                sseClients.delete(res);
            });
            return;
        }

        // ROUTE 3: Oracle Spot Price
        if (pathname === '/oracle') {
            const proof = await getPythProof({ feedIds: netConfig.pythFeedId });
            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                symbol: TARGET_SYMBOL,
                feedId: proof.primaryFeedId,
                price: proof.primaryPrice,
                confidence: proof.parsedPrices[0]?.confidence ?? null,
                publishTime: proof.primaryPublishTime,
                cached: proof.cached ?? false,
                cachedAgeMs: proof.cachedAgeMs ?? 0
            });
            return;
        }

        // ROUTE 4: Pyth Proof
        if (pathname === '/proof') {
            const proof = await getPythProof({ feedIds: netConfig.pythFeedId });
            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                feedId: proof.primaryFeedId,
                price: proof.primaryPrice,
                priceUpdateData: proof.priceUpdateData,
                cached: proof.cached ?? false,
                cachedAgeMs: proof.cachedAgeMs ?? 0
            });
            return;
        }

        // ROUTE 5: Protocol Info
        if (pathname === '/protocol-info') {
            if (fs.existsSync(netConfig.protocolInfoFile)) {
                const info = JSON.parse(fs.readFileSync(netConfig.protocolInfoFile, 'utf8'));
                sendJson(res, 200, { success: true, network: activeNetwork, data: info });
            } else {
                try {
                    const info = await updateProtocolInfo(null, activeNetwork);
                    sendJson(res, 200, { success: true, network: activeNetwork, data: info });
                } catch (err) {
                    sendJson(res, 500, { success: false, network: activeNetwork, error: `Failed to fetch protocol info for ${activeNetwork}: ${err.message}` });
                }
            }
            return;
        }

        // ROUTE 6: Trader Portfolio
        if (pathname.startsWith('/trader/')) {
            const traderAddress = pathname.replace('/trader/', '').trim();
            if (!traderAddress) {
                sendJson(res, 400, { success: false, error: 'Trader address is required.' });
                return;
            }

            const trades = getTradesByTrader(traderAddress, activeNetwork);
            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                trader: traderAddress,
                totalPositions: trades.length,
                trades
            });
            return;
        }

        // ROUTE 6.5: Single Trade Details
        if (pathname.startsWith('/trade/')) {
            const tradeId = pathname.replace('/trade/', '').trim();
            if (!tradeId) {
                sendJson(res, 400, { success: false, error: 'Trade ID is required.' });
                return;
            }

            const trade = getTradeById(tradeId, activeNetwork);
            if (!trade) {
                sendJson(res, 404, { success: false, error: `Trade #${tradeId} not found on ${activeNetwork}.` });
                return;
            }

            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                trade
            });
            return;
        }

        // ROUTE 7: Chart History
        if (pathname === '/chart/history') {
            const to = query.to ? Number(query.to) : Math.floor(Date.now() / 1000);
            const from = query.from ? Number(query.from) : to - (24 * 3600);
            const resolution = query.resolution || '1';

            try {
                const candles = await pythService.get1mHistory(TARGET_SYMBOL, from, to);
                sendJson(res, 200, {
                    success: true,
                    symbol: TARGET_SYMBOL,
                    resolution,
                    from,
                    to,
                    count: candles.length,
                    candles
                });
            } catch (err) {
                sendJson(res, 500, { success: false, error: `Failed fetching chart history: ${err.message}` });
            }
            return;
        }

        // ROUTE 8: Chart Sparkline & 24h Stats
        if (pathname === '/chart/sparkline' || pathname === '/chart/stats' || pathname === '/chart/24h') {
            try {
                if (fs.existsSync(netConfig.sparklineFile)) {
                    const sparkline = JSON.parse(fs.readFileSync(netConfig.sparklineFile, 'utf8'));
                    if (sparkline.high_24h !== undefined) {
                        sendJson(res, 200, { success: true, ...sparkline });
                        return;
                    }
                }

                let m1Candles = await storageService.load(TARGET_SYMBOL, "1");
                if (!m1Candles || m1Candles.length === 0) {
                    const now = Math.floor(Date.now() / 1000);
                    const from = now - (86400 * 7);
                    m1Candles = await pythService.get1mHistory(TARGET_SYMBOL, from, now);
                }

                if (m1Candles && m1Candles.length > 0) {
                    const sparklineData = buildSparklineData(TARGET_SYMBOL, m1Candles);
                    saveSparklineData(TARGET_SYMBOL, sparklineData);
                    sendJson(res, 200, { success: true, ...sparklineData });
                    return;
                }

                sendJson(res, 404, { success: false, error: 'Chart data not yet available.' });
            } catch (err) {
                sendJson(res, 500, { success: false, error: `Failed computing chart stats: ${err.message}` });
            }
            return;
        }

        // ROUTE 8b: Multi-Asset Market Summaries & Variations (Forex, Metals, Commodities, Equities, Crypto)
        if (pathname === '/markets' || pathname === '/markets/summary' || pathname === '/markets/refresh') {
            try {
                const { updateMarketPriceDifferences } = require('./getMarketPrices');
                const isForceRefresh = pathname === '/markets/refresh';
                const marketsFile = path.join(__dirname, 'data', 'marketsSummary.json');

                if (!isForceRefresh && fs.existsSync(marketsFile)) {
                    const data = JSON.parse(fs.readFileSync(marketsFile, 'utf8'));
                    sendJson(res, 200, { success: true, ...data });
                    return;
                }

                const liveData = await updateMarketPriceDifferences();
                sendJson(res, 200, { success: true, refreshed: isForceRefresh, ...liveData });
            } catch (err) {
                sendJson(res, 500, { success: false, error: `Failed fetching markets summary: ${err.message}` });
            }
            return;
        }

        // ROUTE 9: Liquidations
        if (pathname === '/liquidations') {
            const report = calculateOpenTradesLiquidation(activeNetwork);
            sendJson(res, 200, { success: true, ...report });
            return;
        }

        // ROUTE 10: Average Open Prices
        if (pathname === '/average-prices') {
            const avgReport = calculateAverageOpenPrices(activeNetwork);
            sendJson(res, 200, { success: true, ...avgReport });
            return;
        }

        // ROUTE 11: Recent Trades
        if (pathname === '/trades') {
            const limit = query.limit ? parseInt(query.limit, 10) : 50;
            const result = getRecentTrades(limit, activeNetwork);
            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                totalTrades: result.length,
                trades: result
            });
            return;
        }

        // ROUTE 12: Referrals
        if (pathname.startsWith('/referrals/')) {
            const address = pathname.split('/')[2];
            if (!address) {
                sendJson(res, 400, { success: false, error: "Invalid address." });
                return;
            }
            const referralData = getReferralInfo(address, activeNetwork);
            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                ...(referralData || { address, referrer: null, affiliates: [] })
            });
            return;
        }

        // ROUTE 13: Volume
        if (pathname.startsWith('/volume/')) {
            const address = pathname.split('/')[2];
            if (!address) {
                sendJson(res, 400, { success: false, error: "Invalid address." });
                return;
            }
            const volumeData = getTraderVolume(address, activeNetwork);
            sendJson(res, 200, {
                success: true,
                network: activeNetwork,
                ...volumeData
            });
            return;
        }

        // ROUTE 14: Borrow Index
        if (pathname === '/borrow-index' || pathname === '/accrued-interest' || pathname === '/borrow-fees') {
            const borrowIndexReport = calculateWeightedAverageBorrowIndex(activeNetwork);
            sendJson(res, 200, {
                success: true,
                ...borrowIndexReport
            });
            return;
        }

        // 404 Not Found
        sendJson(res, 404, {
            success: false,
            error: `Route '${pathname}' not found. Visit / for API documentation.`
        });

    } catch (error) {
        console.error(`[API ERROR] ${error.message}`);
        sendJson(res, 500, {
            success: false,
            error: error.message
        });
    }
});

server.listen(PORT, () => {
    console.log('='.repeat(80));
    console.log(`⚡ BROKEX PUBLIC API SERVER ACTIVE`);
    console.log(`🌐 Local URL     : http://localhost:${PORT}`);
    console.log(`📖 Documentation : http://localhost:${PORT}/`);
    console.log(`📡 SSE Stream    : http://localhost:${PORT}/stream`);
    console.log(`⛓️ Default Net   : ${config.network.toUpperCase()}`);
    console.log('='.repeat(80));

    // Auto-update multi-asset market prices on startup & every 1 hour (3600000 ms)
    const { updateMarketPriceDifferences } = require('./getMarketPrices');
    updateMarketPriceDifferences().catch(err => {
        console.warn(`[MARKETS] Initial price differences fetch failed: ${err.message}`);
    });

    setInterval(() => {
        console.log('[MARKETS] Running scheduled 1-hour price differences update...');
        updateMarketPriceDifferences().catch(err => {
            console.warn(`[MARKETS] Scheduled price differences update failed: ${err.message}`);
        });
    }, 60 * 60 * 1000);
});

module.exports = server;
