/**
 * ==============================================================================
 * BROKEX REAL-TIME EXECUTION ENGINE BOT (`executionEngine.js`)
 * ==============================================================================
 *
 * Continuous execution daemon that:
 * 1. Connects to Pyth Real-Time SSE streaming feed
 * 2. On each incoming price tick for PYTH_SYMBOL:
 *    a. Checks Pending Orders (`getExecutableOrders.js`)
 *    b. Checks Open Positions Stops (`getExecutableStops.js`)
 *    c. Checks Liquidations (`getLiquidationPrices.js`)
 * 3. Triggers atomic gasless batch execution via Coinbase Paymaster (`paymaster/executeService.js`)
 *
 * Supports:
 *   node executionEngine.js testnet
 *   node executionEngine.js mainnet
 *   node executionEngine.js --dry-run
 * ==============================================================================
 */

const { getExecutablePendingOrders } = require('./getExecutableOrders');
const { getExecutableStops } = require('./getExecutableStops');
const { calculateOpenTradesLiquidation } = require('./getLiquidationPrices');
const { executeTradesGasless } = require('./paymaster/executeService');
const { getNetworkConfig } = require('./config');

const config = getNetworkConfig();

const STREAM_URL = config.pythStreamingUrl;
const TARGET_SYMBOL = config.pythSymbol;
const TARGET_FEED_ID = config.pythFeedId;
const NETWORK = config.network;

// Command line flags
const IS_DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-d');

// Cooldown tracker to prevent duplicate calls while transaction is mining
const executedTradesCooldown = new Map(); // tradeId -> timestamp
const COOLDOWN_MS = 30000; // 30s cooldown per trade once submitted

let isProcessingBatch = false;
let tickCount = 0;
let lastEvaluatedPrice = 0;

function findTriggeredTrades(currentPrice) {
    const rawPriceScaled = BigInt(Math.round(currentPrice * 1e6)); // Scale to 6 decimals (1e6)
    const triggered = [];
    const now = Date.now();
    let stats = { pendingEvaluated: 0, stopsEvaluated: 0, openEvaluated: 0 };

    // 1. Evaluate Pending Orders (Limit & Stop)
    try {
        const pending = getExecutablePendingOrders(rawPriceScaled, NETWORK);
        stats.pendingEvaluated = pending.length;
        for (const item of pending) {
            const lastExecuted = executedTradesCooldown.get(item.tradeId) || 0;
            if (now - lastExecuted > COOLDOWN_MS) {
                triggered.push({
                    tradeId: item.tradeId,
                    type: 'PENDING_ORDER',
                    reason: item.orderType,
                    details: item.reason
                });
            }
        }
    } catch (err) {
        console.error(`[EXEC-BOT] Error checking pending orders: ${err.message}`);
    }

    // 2. Evaluate Open Positions Stops (Stop-Loss & Take-Profit)
    try {
        const stops = getExecutableStops(rawPriceScaled, NETWORK);
        stats.stopsEvaluated = stops.length;
        for (const item of stops) {
            const lastExecuted = executedTradesCooldown.get(item.tradeId) || 0;
            if (now - lastExecuted > COOLDOWN_MS) {
                triggered.push({
                    tradeId: item.tradeId,
                    type: 'STOP_ORDER',
                    reason: item.triggeredAction,
                    details: item.reason
                });
            }
        }
    } catch (err) {
        console.error(`[EXEC-BOT] Error checking stops: ${err.message}`);
    }

    // 3. Evaluate Dynamic On-chain Liquidations
    try {
        const liqs = calculateOpenTradesLiquidation(NETWORK);
        stats.openEvaluated = liqs.openPositions ? liqs.openPositions.length : 0;
        for (const item of (liqs.openPositions || [])) {
            if (!item.liquidationPriceNumber || item.liquidationPriceNumber <= 0) continue;

            const isLiquidatable = (item.direction === 'LONG' && currentPrice <= item.liquidationPriceNumber) ||
                                  (item.direction === 'SHORT' && currentPrice >= item.liquidationPriceNumber);

            if (isLiquidatable) {
                const lastExecuted = executedTradesCooldown.get(item.tradeId) || 0;
                if (now - lastExecuted > COOLDOWN_MS) {
                    triggered.push({
                        tradeId: item.tradeId,
                        type: 'LIQUIDATION',
                        reason: 'LIQUIDATION',
                        details: `Liquidation threshold reached (Spot: $${currentPrice.toFixed(2)}, Liq: $${item.liquidationPriceNumber.toFixed(2)})`
                    });
                }
            }
        }
    } catch (err) {
        console.error(`[EXEC-BOT] Error checking liquidations: ${err.message}`);
    }

    return { triggered, stats };
}

async function handlePriceTick(spotPrice, timestamp) {
    tickCount++;
    lastEvaluatedPrice = spotPrice;

    const timeFormatted = new Date(timestamp * 1000).toLocaleTimeString();
    const { triggered: triggeredTrades, stats } = findTriggeredTrades(spotPrice);

    // Live log on every price tick showing evaluation results
    if (triggeredTrades.length === 0) {
        console.log(`[TICK #${tickCount}] ${timeFormatted} | Spot: $${spotPrice.toFixed(2)} | Evaluating DB (${stats.openEvaluated} open, ${stats.pendingEvaluated} pending) -> No triggers`);
    }

    if (isProcessingBatch) return;
    if (triggeredTrades.length === 0) return;

    isProcessingBatch = true;
    const now = Date.now();

    try {
        console.log('\n' + '='.repeat(80));
        console.log(`🚨 [TRIGGER DETECTED] [${NETWORK.toUpperCase()}] Spot: $${spotPrice.toFixed(2)} | Triggered: ${triggeredTrades.length} Trade(s)`);
        triggeredTrades.forEach(t => {
            console.log(`   👉 Trade #${t.tradeId} (${t.type} - ${t.reason}): ${t.details}`);
            executedTradesCooldown.set(t.tradeId, now);
        });
        console.log('='.repeat(80));

        const uniqueTradeIds = Array.from(new Set(triggeredTrades.map(t => t.tradeId)));

        const result = await executeTradesGasless({
            tradeIds: uniqueTradeIds,
            network: NETWORK,
            spotPrice,
            dryRun: IS_DRY_RUN
        });

        if (result && result.success) {
            console.log(`✅ [BATCH EXECUTION COMPLETE] [${NETWORK.toUpperCase()}] Executed: ${result.executedCount} trade(s)`);
        } else {
            console.warn(`⚠️ [BATCH SKIPPED/REVERTED] [${NETWORK.toUpperCase()}]`);
            uniqueTradeIds.forEach(id => executedTradesCooldown.delete(id));
        }
    } catch (err) {
        console.error(`❌ [EXECUTION ERROR] Failed to process batch: ${err.message}`);
        triggeredTrades.forEach(t => executedTradesCooldown.delete(t.tradeId));
    } finally {
        isProcessingBatch = false;
    }
}

async function startBot() {
    console.log('='.repeat(80));
    console.log(`BROKEX REAL-TIME EXECUTION ENGINE BOT [${NETWORK.toUpperCase()}]`);
    console.log(`Network         : ${NETWORK}`);
    console.log(`Pyth SSE Stream : ${STREAM_URL}`);
    console.log(`Target Symbol   : ${TARGET_SYMBOL}`);
    console.log(`Execution Mode  : ${IS_DRY_RUN ? 'DRY-RUN (Simulated)' : 'LIVE AUTOMATIC BROADCAST'}`);
    console.log('='.repeat(80));

    let retryDelay = 2000;

    while (true) {
        try {
            console.log(`[EXEC-BOT] [CONNECTING] Opening Pyth SSE stream for ${TARGET_SYMBOL}...`);
            const response = await fetch(STREAM_URL);

            if (!response.ok) {
                throw new Error(`Pyth SSE HTTP Error ${response.status}: ${response.statusText}`);
            }

            console.log(`[EXEC-BOT] [CONNECTED] Stream active. Watching for trigger events on ${NETWORK.toUpperCase()}...`);
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
                    let trimmed = line.trim();
                    if (!trimmed) continue;
                    if (trimmed.startsWith('data:')) {
                        trimmed = trimmed.slice(5).trim();
                    }
                    if (!trimmed.startsWith('{')) continue;

                    try {
                        const payload = JSON.parse(trimmed);
                        if (payload.id === TARGET_SYMBOL && payload.p !== undefined) {
                            const spotPrice = Number(payload.p);
                            const timestamp = payload.t || Math.floor(Date.now() / 1000);
                            await handlePriceTick(spotPrice, timestamp);
                        }
                    } catch {}
                }
            }
        } catch (streamErr) {
            console.error(`[EXEC-BOT] [STREAM DISCONNECTED] Error: ${streamErr.message}. Reconnecting in ${retryDelay / 1000}s...`);
            await new Promise(r => setTimeout(r, retryDelay));
            retryDelay = Math.min(retryDelay * 1.5, 30000);
        }
    }
}

if (require.main === module) {
    startBot().catch(err => {
        console.error(`[FATAL BOT ERROR] ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    findTriggeredTrades,
    handlePriceTick,
    startBot
};
