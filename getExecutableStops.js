const { updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

function getExecutableStops(currentMarketPrice, network) {
    if (!currentMarketPrice) return [];
    const marketPrice = BigInt(currentMarketPrice.toString());

    const trades = updateTradesDatabase(network);
    const triggeredPositions = [];

    for (const trade of Object.values(trades)) {
        if (trade.status !== 'OPEN') continue;

        const hasStopLoss = trade.currentStopLoss && trade.currentStopLoss !== '0';
        const hasTakeProfit = trade.currentTakeProfit && trade.currentTakeProfit !== '0';

        if (!hasStopLoss && !hasTakeProfit) continue;

        let triggeredAction = null;
        let triggerPrice = null;
        let triggerReason = '';

        const stopLoss = hasStopLoss ? BigInt(trade.currentStopLoss) : null;
        const takeProfit = hasTakeProfit ? BigInt(trade.currentTakeProfit) : null;

        if (trade.directionName === 'LONG') {
            if (stopLoss && marketPrice <= stopLoss) {
                triggeredAction = 'STOP_LOSS';
                triggerPrice = trade.currentStopLoss;
                triggerReason = `Long SL matched (Market: ${marketPrice} <= SL: ${stopLoss})`;
            } else if (takeProfit && marketPrice >= takeProfit) {
                triggeredAction = 'TAKE_PROFIT';
                triggerPrice = trade.currentTakeProfit;
                triggerReason = `Long TP matched (Market: ${marketPrice} >= TP: ${takeProfit})`;
            }
        } else if (trade.directionName === 'SHORT') {
            if (stopLoss && marketPrice >= stopLoss) {
                triggeredAction = 'STOP_LOSS';
                triggerPrice = trade.currentStopLoss;
                triggerReason = `Short SL matched (Market: ${marketPrice} >= SL: ${stopLoss})`;
            } else if (takeProfit && marketPrice <= takeProfit) {
                triggeredAction = 'TAKE_PROFIT';
                triggerPrice = trade.currentTakeProfit;
                triggerReason = `Short TP matched (Market: ${marketPrice} <= TP: ${takeProfit})`;
            }
        }

        if (triggeredAction) {
            triggeredPositions.push({
                tradeId: trade.tradeId,
                trader: trade.trader,
                direction: trade.directionName,
                leverage: trade.leverage,
                margin: trade.margin,
                openInterest: trade.openInterest,
                executionPriceOpen: trade.executionPriceOpen,
                triggeredAction,
                triggerPrice,
                stopLoss: trade.currentStopLoss || '0',
                takeProfit: trade.currentTakeProfit || '0',
                currentMarketPrice: marketPrice.toString(),
                reason: triggerReason
            });
        }
    }

    return triggeredPositions;
}

if (require.main === module) {
    const netConfig = getNetworkConfig();
    const mockPrice = process.argv[2] ? BigInt(process.argv[2]) : 4420000000n;
    console.log(`[CHECK] Open positions stops evaluation at price: ${mockPrice} [${netConfig.network}]`);
    const results = getExecutableStops(mockPrice, netConfig.network);
    console.log(`Found ${results.length} triggerable positions:`, JSON.stringify(results, null, 2));
}

module.exports = {
    getExecutableStops
};
