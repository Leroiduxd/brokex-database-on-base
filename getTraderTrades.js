const { updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

function getTradesByTrader(traderAddress, network) {
    if (!traderAddress) return [];
    
    const target = traderAddress.trim().toLowerCase();
    const trades = updateTradesDatabase(network);
    
    return Object.values(trades).filter(trade => 
        trade.trader && trade.trader.toLowerCase() === target
    );
}

if (require.main === module) {
    const netConfig = getNetworkConfig();
    const traderInput = process.argv[2];

    if (!traderInput) {
        console.log('Usage: node getTraderTrades.js <traderAddress> [testnet|mainnet]');
        console.log('Example: node getTraderTrades.js 0xEaeAe8E46992e7D3832f964B320D41874476508b');
        process.exit(0);
    }

    const results = getTradesByTrader(traderInput, netConfig.network);

    console.log('='.repeat(80));
    console.log(`DETAILED TRADER PORTFOLIO REPORT [${netConfig.network.toUpperCase()}]`);
    console.log(`Trader Address : ${traderInput}`);
    console.log(`Total Positions: ${results.length}`);
    console.log('='.repeat(80));

    if (results.length === 0) {
        console.log('No trades found for this trader address.');
    } else {
        results.forEach((trade, index) => {
            console.log(`\n#${index + 1} - Trade ID: ${trade.tradeId}`);
            console.log(`  Status         : ${trade.status}`);
            console.log(`  Direction      : ${trade.directionName}`);
            console.log(`  Order Type     : ${trade.orderTypeName}`);
            console.log(`  Leverage       : ${trade.leverage}x`);
            console.log(`  Margin         : ${trade.margin ? (Number(trade.margin) / 1e6).toFixed(2) + ' USDC' : 'N/A'}`);
            console.log(`  Open Interest  : ${trade.openInterest ? (Number(trade.openInterest) / 1e6).toFixed(2) + ' USD' : 'N/A'}`);
            console.log(`  Target Price   : ${trade.targetPrice ? (Number(trade.targetPrice) / 1e6).toFixed(2) + ' USD' : 'N/A'}`);
            console.log(`  Execution Open : ${trade.executionPriceOpen ? (Number(trade.executionPriceOpen) / 1e6).toFixed(2) + ' USD' : 'N/A'}`);
            console.log(`  Final PnL      : ${trade.finalPnl !== null ? (Number(trade.finalPnl) / 1e6).toFixed(2) + ' USDC' : 'N/A'}`);
        });
    }
}

module.exports = {
    getTradesByTrader
};
