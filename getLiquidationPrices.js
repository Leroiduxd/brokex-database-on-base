const fs = require('fs');
const path = require('path');
const { updateTradesDatabase } = require('./tradeService');
const { getNetworkConfig } = require('./config');

const PRECISION = 1000000n; // 1e6
const BORROW_INDEX_PRECISION = 1000000000000000000n; // 1e18

function loadProtocolInfo(network) {
    const config = getNetworkConfig(network);
    if (fs.existsSync(config.protocolInfoFile)) {
        try {
            return JSON.parse(fs.readFileSync(config.protocolInfoFile, 'utf8'));
        } catch {}
    }
    return {
        liquidationThreshold: "950000",
        currentLongBorrowIndex: "0",
        currentShortBorrowIndex: "0"
    };
}

function calculateOpenTradesLiquidation(network) {
    const config = getNetworkConfig(network);
    const trades = updateTradesDatabase(network);
    const protocolInfo = loadProtocolInfo(network);

    const liquidationThreshold = BigInt(protocolInfo.liquidationThreshold || "950000");
    const currentLongBorrowIndex = BigInt(protocolInfo.currentLongBorrowIndex || "0");
    const currentShortBorrowIndex = BigInt(protocolInfo.currentShortBorrowIndex || "0");

    const openPositions = [];

    for (const trade of Object.values(trades)) {
        if (trade.status !== 'OPEN') continue;

        const tradeId = trade.tradeId;
        const trader = trade.trader;
        const direction = trade.directionName;
        const isLong = direction === 'LONG';
        const leverage = parseInt(trade.leverage || '1', 10);

        const margin = BigInt(trade.margin || '0');
        const openInterest = BigInt(trade.openInterest || (margin * BigInt(leverage)).toString());
        const entryPrice = BigInt(trade.executionPriceOpen || trade.targetPrice || '0');
        const borrowIndexAtOpen = BigInt(trade.borrowIndexAtOpen || '0');

        if (margin === 0n || openInterest === 0n || entryPrice === 0n) continue;

        // 1. Accrued Borrow Fee
        const currentIndex = isLong ? currentLongBorrowIndex : currentShortBorrowIndex;
        let indexDelta = 0n;
        if (currentIndex > borrowIndexAtOpen) {
            indexDelta = currentIndex - borrowIndexAtOpen;
        }

        const borrowFee = (openInterest * indexDelta) / BORROW_INDEX_PRECISION;

        // 2. Maximum Allowable Loss
        const liquidationLoss = (margin * liquidationThreshold) / PRECISION;

        // 3. Exact Liquidation Price
        let liquidationPrice = 0n;

        if (borrowFee <= liquidationLoss) {
            const netLossAllowed = liquidationLoss - borrowFee;
            const move = (entryPrice * netLossAllowed) / openInterest;

            if (isLong) {
                liquidationPrice = entryPrice > move ? entryPrice - move : 0n;
            } else {
                liquidationPrice = entryPrice + move;
            }
        } else {
            const feeDeficit = borrowFee - liquidationLoss;
            const move = (entryPrice * feeDeficit) / openInterest;

            if (isLong) {
                liquidationPrice = entryPrice + move;
            } else {
                liquidationPrice = entryPrice > move ? entryPrice - move : 0n;
            }
        }

        const liqPriceNumber = Number(liquidationPrice) / 1e6;
        const entryPriceNumber = Number(entryPrice) / 1e6;
        const marginUsd = Number(margin) / 1e6;
        const oiUsd = Number(openInterest) / 1e6;
        const borrowFeeUsd = Number(borrowFee) / 1e6;

        openPositions.push({
            tradeId,
            trader,
            direction,
            leverage,
            margin: margin.toString(),
            marginUsd: marginUsd.toFixed(2),
            openInterest: openInterest.toString(),
            openInterestUsd: oiUsd.toFixed(2),
            entryPrice: entryPrice.toString(),
            entryPriceNumber,
            entryPriceFormatted: `$${entryPriceNumber.toFixed(2)}`,
            borrowIndexAtOpen: borrowIndexAtOpen.toString(),
            currentBorrowIndex: currentIndex.toString(),
            accruedBorrowFee: borrowFee.toString(),
            accruedBorrowFeeUsd: `$${borrowFeeUsd.toFixed(4)}`,
            liquidationPrice: liquidationPrice.toString(),
            liquidationPriceNumber: liqPriceNumber,
            liquidationPriceFormatted: `$${liqPriceNumber.toFixed(2)}`,
            stopLoss: trade.currentStopLoss ? `$${(Number(trade.currentStopLoss) / 1e6).toFixed(2)}` : 'N/A',
            takeProfit: trade.currentTakeProfit ? `$${(Number(trade.currentTakeProfit) / 1e6).toFixed(2)}` : 'N/A'
        });
    }

    return {
        updatedAt: new Date().toISOString(),
        network: config.network,
        liquidationThresholdRatio: `${(Number(liquidationThreshold) / 10000).toFixed(2)}%`,
        totalOpenPositions: openPositions.length,
        openPositions
    };
}

if (require.main === module) {
    const netConfig = getNetworkConfig();
    const result = calculateOpenTradesLiquidation(netConfig.network);
    console.log('='.repeat(80));
    console.log(`BROKEX OPEN TRADES LIQUIDATION REPORT [${netConfig.network.toUpperCase()}]`);
    console.log(`Liquidation Threshold : ${result.liquidationThresholdRatio}`);
    console.log(`Total Open Positions  : ${result.totalOpenPositions}`);
    console.log('='.repeat(80));
    console.log(JSON.stringify(result.openPositions, null, 2));
}

module.exports = {
    calculateOpenTradesLiquidation
};
