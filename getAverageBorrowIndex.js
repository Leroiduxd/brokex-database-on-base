const fs = require('fs');
const path = require('path');
const { updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

const BORROW_INDEX_PRECISION = 1000000000000000000n; // 1e18
const PRICE_SCALE = 1e6;

function loadProtocolInfo(network) {
    const config = getNetworkConfig(network);
    if (fs.existsSync(config.protocolInfoFile)) {
        try {
            return JSON.parse(fs.readFileSync(config.protocolInfoFile, 'utf8'));
        } catch {}
    }
    return {
        currentLongBorrowIndex: "0",
        currentShortBorrowIndex: "0"
    };
}

function calculateWeightedAverageBorrowIndex(network) {
    const config = getNetworkConfig(network);
    const trades = updateTradesDatabase(network);
    const protocolInfo = loadProtocolInfo(network);

    const currentLongBorrowIndex = BigInt(protocolInfo.currentLongBorrowIndex || "0");
    const currentShortBorrowIndex = BigInt(protocolInfo.currentShortBorrowIndex || "0");

    let longTotalWeightedIndex = 0n;
    let longTotalOI = 0n;
    let longCount = 0;
    let longTotalAccruedInterest = 0n;

    let shortTotalWeightedIndex = 0n;
    let shortTotalOI = 0n;
    let shortCount = 0;
    let shortTotalAccruedInterest = 0n;

    const openLongs = [];
    const openShorts = [];

    for (const trade of Object.values(trades)) {
        if (trade.status !== 'OPEN') continue;

        const isLong = trade.directionName === 'LONG';
        const oi = BigInt(trade.openInterest || '0');
        const borrowIndexAtOpen = BigInt(trade.borrowIndexAtOpen || '0');

        if (oi === 0n) continue;

        const currentIndex = isLong ? currentLongBorrowIndex : currentShortBorrowIndex;
        let indexDelta = 0n;
        if (currentIndex > borrowIndexAtOpen) {
            indexDelta = currentIndex - borrowIndexAtOpen;
        }

        const tradeAccruedInterest = (oi * indexDelta) / BORROW_INDEX_PRECISION;
        const weightedIndex = oi * borrowIndexAtOpen;

        const positionData = {
            tradeId: trade.tradeId,
            trader: trade.trader,
            openInterestRaw: oi.toString(),
            openInterestUsd: (Number(oi) / PRICE_SCALE).toFixed(2),
            borrowIndexAtOpen: borrowIndexAtOpen.toString(),
            currentBorrowIndex: currentIndex.toString(),
            indexDelta: indexDelta.toString(),
            accruedInterestRaw: tradeAccruedInterest.toString(),
            accruedInterestUsd: (Number(tradeAccruedInterest) / PRICE_SCALE).toFixed(4)
        };

        if (isLong) {
            longTotalWeightedIndex += weightedIndex;
            longTotalOI += oi;
            longCount++;
            longTotalAccruedInterest += tradeAccruedInterest;
            openLongs.push(positionData);
        } else {
            shortTotalWeightedIndex += weightedIndex;
            shortTotalOI += oi;
            shortCount++;
            shortTotalAccruedInterest += tradeAccruedInterest;
            openShorts.push(positionData);
        }
    }

    const avgLongIndexAtOpen = longTotalOI > 0n ? (longTotalWeightedIndex / longTotalOI) : 0n;
    const avgShortIndexAtOpen = shortTotalOI > 0n ? (shortTotalWeightedIndex / shortTotalOI) : 0n;

    const totalAccruedInterestRaw = longTotalAccruedInterest + shortTotalAccruedInterest;
    const totalAccruedInterestUsd = (Number(totalAccruedInterestRaw) / PRICE_SCALE).toFixed(4);

    return {
        updatedAt: new Date().toISOString(),
        network: config.network,
        totalOpenPositions: longCount + shortCount,
        totalAccruedInterestUsd: `$${totalAccruedInterestUsd}`,
        totalAccruedInterestRaw: totalAccruedInterestRaw.toString(),
        long: {
            count: longCount,
            openInterestRaw: longTotalOI.toString(),
            openInterestUsd: `$${(Number(longTotalOI) / PRICE_SCALE).toFixed(2)}`,
            currentLongBorrowIndex: currentLongBorrowIndex.toString(),
            averageBorrowIndexAtOpen: avgLongIndexAtOpen.toString(),
            indexDeltaFromAverage: (currentLongBorrowIndex > avgLongIndexAtOpen ? currentLongBorrowIndex - avgLongIndexAtOpen : 0n).toString(),
            accruedInterestRaw: longTotalAccruedInterest.toString(),
            accruedInterestUsd: `$${(Number(longTotalAccruedInterest) / PRICE_SCALE).toFixed(4)}`,
            positions: openLongs
        },
        short: {
            count: shortCount,
            openInterestRaw: shortTotalOI.toString(),
            openInterestUsd: `$${(Number(shortTotalOI) / PRICE_SCALE).toFixed(2)}`,
            currentShortBorrowIndex: currentShortBorrowIndex.toString(),
            averageBorrowIndexAtOpen: avgShortIndexAtOpen.toString(),
            indexDeltaFromAverage: (currentShortBorrowIndex > avgShortIndexAtOpen ? currentShortBorrowIndex - avgShortIndexAtOpen : 0n).toString(),
            accruedInterestRaw: shortTotalAccruedInterest.toString(),
            accruedInterestUsd: `$${(Number(shortTotalAccruedInterest) / PRICE_SCALE).toFixed(4)}`,
            positions: openShorts
        }
    };
}

if (require.main === module) {
    const netConfig = getNetworkConfig();
    const result = calculateWeightedAverageBorrowIndex(netConfig.network);
    console.log('='.repeat(75));
    console.log(`BROKEX BORROW INDEX & ACCRUED INTEREST REPORT [${netConfig.network.toUpperCase()}]`);
    console.log(`Total Open Positions    : ${result.totalOpenPositions}`);
    console.log(`Total Accrued Interest  : ${result.totalAccruedInterestUsd} USD`);
    console.log('='.repeat(75));
    console.log(`🟢 LONG Positions (${result.long.count}):`);
    console.log(`   - Open Interest          : ${result.long.openInterestUsd}`);
    console.log(`   - Current Protocol Index : ${result.long.currentLongBorrowIndex}`);
    console.log(`   - Avg Index at Open      : ${result.long.averageBorrowIndexAtOpen}`);
    console.log(`   - Accrued Interest       : ${result.long.accruedInterestUsd} USD`);
    console.log(`🔴 SHORT Positions (${result.short.count}):`);
    console.log(`   - Open Interest          : ${result.short.openInterestUsd}`);
    console.log(`   - Current Protocol Index : ${result.short.currentShortBorrowIndex}`);
    console.log(`   - Avg Index at Open      : ${result.short.averageBorrowIndexAtOpen}`);
    console.log(`   - Accrued Interest       : ${result.short.accruedInterestUsd} USD`);
    console.log('='.repeat(75));
}

module.exports = {
    calculateWeightedAverageBorrowIndex
};
