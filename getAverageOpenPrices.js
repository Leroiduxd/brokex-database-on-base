const { updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

function calculateAverageOpenPrices(network) {
    const config = getNetworkConfig(network);
    const trades = updateTradesDatabase(network);

    let longTotalWeightedProduct = 0n;
    let longTotalOI = 0n;
    let longCount = 0;

    let shortTotalWeightedProduct = 0n;
    let shortTotalOI = 0n;
    let shortCount = 0;

    const openLongs = [];
    const openShorts = [];

    for (const trade of Object.values(trades)) {
        if (trade.status !== 'OPEN') continue;

        const isLong = trade.directionName === 'LONG';
        const oi = BigInt(trade.openInterest || '0');
        const entryPrice = BigInt(trade.executionPriceOpen || trade.targetPrice || '0');

        if (oi === 0n || entryPrice === 0n) continue;

        const weightedProduct = oi * entryPrice;

        if (isLong) {
            longTotalWeightedProduct += weightedProduct;
            longTotalOI += oi;
            longCount++;
            openLongs.push({
                tradeId: trade.tradeId,
                trader: trade.trader,
                entryPrice: entryPrice.toString(),
                openInterest: oi.toString()
            });
        } else {
            shortTotalWeightedProduct += weightedProduct;
            shortTotalOI += oi;
            shortCount++;
            openShorts.push({
                tradeId: trade.tradeId,
                trader: trade.trader,
                entryPrice: entryPrice.toString(),
                openInterest: oi.toString()
            });
        }
    }

    const averageLongPriceRaw = longTotalOI > 0n ? (longTotalWeightedProduct / longTotalOI) : 0n;
    const averageShortPriceRaw = shortTotalOI > 0n ? (shortTotalWeightedProduct / shortTotalOI) : 0n;

    const averageLongPriceNumber = Number(averageLongPriceRaw) / 1e6;
    const averageShortPriceNumber = Number(averageShortPriceRaw) / 1e6;

    const totalOpenInterestUsd = (Number(longTotalOI + shortTotalOI) / 1e6).toFixed(2);
    const longOpenInterestUsd = (Number(longTotalOI) / 1e6).toFixed(2);
    const shortOpenInterestUsd = (Number(shortTotalOI) / 1e6).toFixed(2);

    return {
        updatedAt: new Date().toISOString(),
        network: config.network,
        totalOpenPositions: longCount + shortCount,
        totalOpenInterestUsd: `$${totalOpenInterestUsd}`,
        long: {
            count: longCount,
            openInterestRaw: longTotalOI.toString(),
            openInterestUsd: `$${longOpenInterestUsd}`,
            averageEntryPriceRaw: averageLongPriceRaw.toString(),
            averageEntryPriceNumber: averageLongPriceNumber,
            averageEntryPriceFormatted: `$${averageLongPriceNumber.toFixed(2)}`,
            positions: openLongs
        },
        short: {
            count: shortCount,
            openInterestRaw: shortTotalOI.toString(),
            openInterestUsd: `$${shortOpenInterestUsd}`,
            averageEntryPriceRaw: averageShortPriceRaw.toString(),
            averageEntryPriceNumber: averageShortPriceNumber,
            averageEntryPriceFormatted: `$${averageShortPriceNumber.toFixed(2)}`,
            positions: openShorts
        }
    };
}

if (require.main === module) {
    const netConfig = getNetworkConfig();
    const result = calculateAverageOpenPrices(netConfig.network);
    console.log('='.repeat(70));
    console.log(`BROKEX WEIGHTED AVERAGE OPEN PRICES [${netConfig.network.toUpperCase()}]`);
    console.log(`Network                : ${result.network}`);
    console.log(`Total Open Interest    : ${result.totalOpenInterestUsd}`);
    console.log(`Total Open Positions   : ${result.totalOpenPositions}`);
    console.log('='.repeat(70));
    console.log(`🟢 LONG Positions (${result.long.count}):`);
    console.log(`   - Open Interest     : ${result.long.openInterestUsd}`);
    console.log(`   - Avg Entry Price   : ${result.long.averageEntryPriceFormatted}`);
    console.log(`🔴 SHORT Positions (${result.short.count}):`);
    console.log(`   - Open Interest     : ${result.short.openInterestUsd}`);
    console.log(`   - Avg Entry Price   : ${result.short.averageEntryPriceFormatted}`);
    console.log('='.repeat(70));
}

module.exports = {
    calculateAverageOpenPrices
};
