const { updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

/**
 * Checks if a pending LIMIT or STOP order is triggerable at the current market price.
 * 
 * Rules for Pending Orders (Status: CREATED):
 * - LIMIT Order (orderType = 1):
 *   - LONG (direction = 1): Buy at targetPrice or cheaper (marketPrice <= targetPrice)
 *   - SHORT (direction = 0): Sell at targetPrice or better (marketPrice >= targetPrice)
 * 
 * - STOP Order (orderType = 2):
 *   - LONG (direction = 1): Buy on upward breakout (marketPrice >= targetPrice)
 *   - SHORT (direction = 0): Sell on downward breakdown (marketPrice <= targetPrice)
 * 
 * @param {string|number|BigInt} currentMarketPrice - Oracle/Market price
 * @param {string} [network] - 'testnet' | 'mainnet'
 * @returns {Array} List of executable pending orders with details
 */
function getExecutablePendingOrders(currentMarketPrice, network) {
    if (!currentMarketPrice) return [];
    const marketPrice = BigInt(currentMarketPrice.toString());

    const trades = updateTradesDatabase(network);
    const executableOrders = [];

    for (const trade of Object.values(trades)) {
        // Pending orders have status CREATED
        if (trade.status !== 'CREATED') continue;
        if (!trade.targetPrice || trade.targetPrice === '0') continue;

        const targetPrice = BigInt(trade.targetPrice);
        let isTriggered = false;
        let triggerReason = '';

        if (trade.orderTypeName === 'LIMIT') {
            if (trade.directionName === 'LONG' && marketPrice <= targetPrice) {
                isTriggered = true;
                triggerReason = `LIMIT LONG matched (Market: ${marketPrice} <= Target: ${targetPrice})`;
            } else if (trade.directionName === 'SHORT' && marketPrice >= targetPrice) {
                isTriggered = true;
                triggerReason = `LIMIT SHORT matched (Market: ${marketPrice} >= Target: ${targetPrice})`;
            }
        } else if (trade.orderTypeName === 'STOP') {
            if (trade.directionName === 'LONG' && marketPrice >= targetPrice) {
                isTriggered = true;
                triggerReason = `STOP LONG triggered (Market: ${marketPrice} >= Target: ${targetPrice})`;
            } else if (trade.directionName === 'SHORT' && marketPrice <= targetPrice) {
                isTriggered = true;
                triggerReason = `STOP SHORT triggered (Market: ${marketPrice} <= Target: ${targetPrice})`;
            }
        }

        if (isTriggered) {
            executableOrders.push({
                tradeId: trade.tradeId,
                trader: trade.trader,
                direction: trade.directionName,
                orderType: trade.orderTypeName,
                leverage: trade.leverage,
                collateral: trade.collateral,
                targetPrice: trade.targetPrice,
                currentMarketPrice: marketPrice.toString(),
                reason: triggerReason
            });
        }
    }

    return executableOrders;
}

// CLI Execution for Testing
if (require.main === module) {
    const netConfig = getNetworkConfig();
    const rawArg = process.argv[2];
    let mockPrice = 4420000000n;
    if (rawArg && !isNaN(rawArg)) {
        mockPrice = BigInt(rawArg);
    }
    
    console.log('='.repeat(70));
    console.log(`BROKEX PENDING ORDERS EXECUTION CHECK [${netConfig.network.toUpperCase()}]`);
    console.log(`Evaluated Market Price : ${mockPrice}`);
    console.log('='.repeat(70));

    const executable = getExecutablePendingOrders(mockPrice, netConfig.network);

    if (executable.length === 0) {
        console.log('No pending orders are currently triggerable at this price.');
    } else {
        console.log(`Found ${executable.length} executable order(s):\n`);
        executable.forEach((order, index) => {
            console.log(`#${index + 1} - Trade ID: ${order.tradeId}`);
            console.log(`  Trader       : ${order.trader}`);
            console.log(`  Order Type   : ${order.direction} ${order.orderType} (${order.leverage}x)`);
            console.log(`  Target Price : ${order.targetPrice}`);
            console.log(`  Market Price : ${order.currentMarketPrice}`);
            console.log(`  Collateral   : ${order.collateral}`);
            console.log(`  Reason       : ${order.reason}\n`);
        });
    }
    console.log('='.repeat(70));
}

module.exports = {
    getExecutablePendingOrders
};
