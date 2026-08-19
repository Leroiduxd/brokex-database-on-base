const { getTradeById, updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

const netConfig = getNetworkConfig();
const tradeIdInput = process.argv[2];

if (!tradeIdInput) {
    console.log(`Usage: node getTrade.js <tradeId> [testnet|mainnet]`);
    console.log(`Example: node getTrade.js 5\n`);
    console.log(`Available Trades Overview [${netConfig.network.toUpperCase()}]:`);
    const trades = updateTradesDatabase(netConfig.network);
    for (const [id, t] of Object.entries(trades)) {
        console.log(`- Trade #${id}: Status = ${t.status} | Trader = ${t.trader} | Type = ${t.directionName} ${t.orderTypeName} (${t.leverage}x) | PnL = ${t.finalPnl ?? 'N/A'}`);
    }
    process.exit(0);
}

const trade = getTradeById(tradeIdInput.toString(), netConfig.network);

if (!trade) {
    console.error(`[ERROR] No trade found with tradeId: ${tradeIdInput} on ${netConfig.network}`);
    process.exit(1);
}

console.log('='.repeat(70));
console.log(`TRADE #${trade.tradeId} FULL REPORT [${netConfig.network.toUpperCase()}]`);
console.log('='.repeat(70));

console.log(`\n[GENERAL INFORMATION]`);
console.log(`  Status          : ${trade.status}`);
console.log(`  Trader          : ${trade.trader}`);
console.log(`  Direction       : ${trade.directionName} (${trade.direction})`);
console.log(`  Order Type      : ${trade.orderTypeName} (${trade.orderType})`);
console.log(`  Leverage        : ${trade.leverage}x`);
console.log(`  Collateral      : ${trade.collateral}`);
console.log(`  Target Price    : ${trade.targetPrice}`);

console.log(`\n[EXECUTION & OPENING]`);
console.log(`  Created At      : ${trade.createdAt ? new Date(parseInt(trade.createdAt) * 1000).toISOString() : 'N/A'}`);
console.log(`  Opened At       : ${trade.openedAt ? new Date(parseInt(trade.openedAt) * 1000).toISOString() : 'N/A'}`);
console.log(`  Oracle Price    : ${trade.oraclePriceOpen}`);
console.log(`  Execution Price : ${trade.executionPriceOpen}`);
console.log(`  Borrow Index    : ${trade.borrowIndexAtOpen}`);

if (trade.status === 'CLOSED') {
    console.log(`\n[CLOSING & SETTLEMENT]`);
    console.log(`  Closed At       : ${trade.closedAt ? new Date(parseInt(trade.closedAt) * 1000).toISOString() : 'N/A'}`);
    console.log(`  Closing Method  : ${trade.closeMethodName} (${trade.closeMethod})`);
    console.log(`  Execution Price : ${trade.executionPriceClose}`);
    console.log(`  Oracle Price    : ${trade.oraclePriceClose}`);
    console.log(`  Realized PnL    : ${trade.finalPnl !== null ? (Number(trade.finalPnl) / 1e6).toFixed(2) + ' USDC' : 'N/A'}`);
    console.log(`  Borrow Fee      : ${trade.borrowFee}`);
    console.log(`  Closing Fee     : ${trade.closingFee}`);
}

console.log('='.repeat(70));
