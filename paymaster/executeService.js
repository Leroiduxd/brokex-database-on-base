/**
 * ==============================================================================
 * COINBASE PAYMASTER TRADE EXECUTOR SERVICE (`paymaster/executeService.js`)
 * ==============================================================================
 *
 * Lightweight, unified on-chain execution pipeline powered by Coinbase Paymaster (ERC-4337).
 * Supports both testnet and mainnet configurations.
 * ==============================================================================
 */

const { encodeFunctionData, parseAbi } = require('viem');
const { getTradesByIds, getLiquidationsByIds } = require('../lensService');
const { getPythProof } = require('../getPythProof');
const { getRiskLimits } = require('./riskManagerService');
const { sendGaslessTransaction, getSmartAccountClient } = require('./client');
const { getNetworkConfig } = require('../config');

// Core Execution ABI
const CORE_EXECUTE_ABI = parseAbi([
    'function execute(bytes[] priceUpdateData, uint256[] tradeIds, uint8[] reasons, (uint256 maxOILong, uint256 maxOIShort, uint256 timestamp, bytes32 r, bytes32 s, uint8 v) limits) payable'
]);

// Protocol Reason Codes
const REASON = {
    EXECUTION: 0,
    STOP_LOSS: 1,
    TAKE_PROFIT: 2,
    LIQUIDATION: 3
};

// Precision Scaling
const PRICE_SCALE = 1e6; // 6 decimals

function toUsd(bigVal) {
    if (!bigVal) return 0;
    return Number(bigVal) / PRICE_SCALE;
}

function evaluateOnChainTrade(trade, liq, spotPrice) {
    if (!trade) {
        return { isTriggered: false, reason: null, details: 'Trade not found' };
    }

    const state = Number(trade.state);
    const direction = Number(trade.direction); // 0 = SHORT, 1 = LONG
    const orderType = Number(trade.orderType); // 0 = MARKET, 1 = LIMIT, 2 = STOP
    const targetPriceUsd = toUsd(trade.price);
    const stopLossUsd = toUsd(trade.stopLoss);
    const takeProfitUsd = toUsd(trade.takeProfit);
    const isLong = direction === 1;

    // 1. Pending Order Execution (State: 0 = CREATED)
    if (state === 0) {
        if (orderType === 1) { // LIMIT
            if (isLong && spotPrice <= targetPriceUsd) {
                return { isTriggered: true, reason: REASON.EXECUTION, details: `LIMIT LONG matched (Spot $${spotPrice.toFixed(2)} <= Target $${targetPriceUsd.toFixed(2)})` };
            }
            if (!isLong && spotPrice >= targetPriceUsd) {
                return { isTriggered: true, reason: REASON.EXECUTION, details: `LIMIT SHORT matched (Spot $${spotPrice.toFixed(2)} >= Target $${targetPriceUsd.toFixed(2)})` };
            }
            return { isTriggered: false, reason: null, details: `LIMIT ${isLong ? 'LONG' : 'SHORT'} waiting (Target $${targetPriceUsd.toFixed(2)})` };
        }

        if (orderType === 2) { // STOP
            if (isLong && spotPrice >= targetPriceUsd) {
                return { isTriggered: true, reason: REASON.EXECUTION, details: `STOP LONG triggered (Spot $${spotPrice.toFixed(2)} >= Target $${targetPriceUsd.toFixed(2)})` };
            }
            if (!isLong && spotPrice <= targetPriceUsd) {
                return { isTriggered: true, reason: REASON.EXECUTION, details: `STOP SHORT triggered (Spot $${spotPrice.toFixed(2)} <= Target $${targetPriceUsd.toFixed(2)})` };
            }
            return { isTriggered: false, reason: null, details: `STOP ${isLong ? 'LONG' : 'SHORT'} waiting (Target $${targetPriceUsd.toFixed(2)})` };
        }

        return { isTriggered: false, reason: null, details: 'Unknown pending order type' };
    }

    // 2. Open Position Evaluation (State: 1 = OPEN)
    if (state === 1) {
        // A. Dynamic On-chain Liquidation Check
        if (liq && liq.open) {
            const liqPriceUsd = toUsd(liq.liquidationPrice);
            if (liqPriceUsd > 0) {
                if (isLong && spotPrice <= liqPriceUsd) {
                    return { isTriggered: true, reason: REASON.LIQUIDATION, details: `LIQUIDATION LONG (Spot $${spotPrice.toFixed(2)} <= Liq $${liqPriceUsd.toFixed(2)})` };
                }
                if (!isLong && spotPrice >= liqPriceUsd) {
                    return { isTriggered: true, reason: REASON.LIQUIDATION, details: `LIQUIDATION SHORT (Spot $${spotPrice.toFixed(2)} >= Liq $${liqPriceUsd.toFixed(2)})` };
                }
            }
        }

        // B. Stop-Loss Check
        if (stopLossUsd > 0) {
            if (isLong && spotPrice <= stopLossUsd) {
                return { isTriggered: true, reason: REASON.STOP_LOSS, details: `STOP-LOSS LONG triggered (Spot $${spotPrice.toFixed(2)} <= SL $${stopLossUsd.toFixed(2)})` };
            }
            if (!isLong && spotPrice >= stopLossUsd) {
                return { isTriggered: true, reason: REASON.STOP_LOSS, details: `STOP-LOSS SHORT triggered (Spot $${spotPrice.toFixed(2)} >= SL $${stopLossUsd.toFixed(2)})` };
            }
        }

        // C. Take-Profit Check
        if (takeProfitUsd > 0) {
            if (isLong && spotPrice >= takeProfitUsd) {
                return { isTriggered: true, reason: REASON.TAKE_PROFIT, details: `TAKE-PROFIT LONG triggered (Spot $${spotPrice.toFixed(2)} >= TP $${takeProfitUsd.toFixed(2)})` };
            }
            if (!isLong && spotPrice <= takeProfitUsd) {
                return { isTriggered: true, reason: REASON.TAKE_PROFIT, details: `TAKE-PROFIT SHORT triggered (Spot $${spotPrice.toFixed(2)} <= TP $${takeProfitUsd.toFixed(2)})` };
            }
        }

        return { isTriggered: false, reason: null, details: 'Position healthy (No SL/TP/LIQ)' };
    }

    return { isTriggered: false, reason: null, details: `Position already resolved (State ${state})` };
}

/**
 * High-performance batch trade executor via Coinbase Paymaster.
 *
 * @param {Object} options
 * @param {Array<string|number>} options.tradeIds - Candidate trade IDs
 * @param {string} [options.network] - 'testnet' | 'mainnet'
 * @param {number} [options.spotPrice] - Optional spot price override
 * @param {boolean} [options.dryRun] - If true, simulates calldata without broadcasting
 * @returns {Promise<{ success: boolean, txHash?: string, executedCount: number, details: Array }>}
 */
async function executeTradesGasless(options = {}) {
    const candidateIds = options.tradeIds || [];
    if (candidateIds.length === 0) {
        return { success: true, executedCount: 0, details: [], message: 'No trade IDs provided' };
    }

    const netConfig = getNetworkConfig(options.network);
    const feedId = options.feedId || netConfig.pythFeedId;
    const coreAddress = netConfig.coreAddress;
    const isDryRun = options.dryRun ?? false;

    if (!coreAddress) {
        throw new Error(`[PAYMASTER EXECUTOR] Missing BROKEX_CORE_ADDRESS for ${netConfig.network}.`);
    }

    console.log('\n' + '='.repeat(80));
    console.log(`⚡ [PAYMASTER EXECUTOR] [${netConfig.network.toUpperCase()}] Evaluating ${candidateIds.length} candidate trade(s): [${candidateIds.join(', ')}]`);

    // 1. Fetch live Pyth price and update proof
    const pythProofData = await getPythProof({ feedIds: [feedId], bypassCache: true });
    const parsedPyth = pythProofData.parsedPrices[0];
    const currentSpotPrice = options.spotPrice || (typeof parsedPyth.price === 'number' ? parsedPyth.price : (Number(parsedPyth.price.price) * Math.pow(10, parsedPyth.price.expo)));
    const priceUpdateData = pythProofData.priceUpdateData.map(p => (p.startsWith('0x') ? p : `0x${p}`));

    console.log(`[PAYMASTER EXECUTOR] Real-time Spot Price: $${currentSpotPrice.toFixed(2)}`);

    // 2. Fetch on-chain state directly from BrokexLens
    const [onChainTrades, onChainLiqs] = await Promise.all([
        getTradesByIds(candidateIds, null, netConfig.network),
        getLiquidationsByIds(candidateIds, null, netConfig.network)
    ]);

    // 3. Evaluate each trade against spot price
    const executableTradeIds = [];
    const executableReasons = [];
    const executionDetails = [];

    for (let i = 0; i < candidateIds.length; i++) {
        const tradeId = candidateIds[i];
        const trade = onChainTrades[i];
        const liq = onChainLiqs[i];

        const evaluation = evaluateOnChainTrade(trade, liq, currentSpotPrice);
        executionDetails.push({ tradeId, ...evaluation });

        if (evaluation.isTriggered) {
            executableTradeIds.push(BigInt(tradeId));
            executableReasons.push(evaluation.reason);
            console.log(`  - Trade #${tradeId}: 🎯 TRIGGERED -> Reason: ${evaluation.reason} (${evaluation.details})`);
        } else {
            console.log(`  - Trade #${tradeId}: ⏳ Skipped (${evaluation.details})`);
        }
    }

    if (executableTradeIds.length === 0) {
        console.log('[PAYMASTER EXECUTOR] No trades met on-chain execution criteria.');
        console.log('='.repeat(80) + '\n');
        return { success: true, executedCount: 0, details: [], message: 'No trades met trigger conditions' };
    }

    // 4. Fetch signed Risk Limits for target network
    console.log(`[PAYMASTER EXECUTOR] Fetching signed RiskLimits from Risk Manager (${netConfig.network})...`);
    const limits = await getRiskLimits(netConfig.network);

    // 5. Encode calldata for BrokexCore.execute()
    const encodedData = encodeFunctionData({
        abi: CORE_EXECUTE_ABI,
        functionName: 'execute',
        args: [
            priceUpdateData,
            executableTradeIds,
            executableReasons,
            limits
        ]
    });

    if (isDryRun) {
        console.log(`[DRY-RUN] Simulation successful! Calldata length: ${encodedData.length} chars.`);
        console.log('='.repeat(80) + '\n');
        return { success: true, dryRun: true, executedCount: executableTradeIds.length, details: executionDetails };
    }

    // 6. Pre-flight simulation check on-chain to prevent UserOp revert errors
    console.log(`[PAYMASTER EXECUTOR] Performing on-chain pre-flight simulation...`);
    const { publicClient } = await getSmartAccountClient({ network: netConfig.network });
    try {
        await publicClient.call({
            to: coreAddress,
            data: encodedData,
            value: 10n
        });
        console.log(`[PAYMASTER EXECUTOR] ✅ Pre-flight simulation passed!`);
    } catch (simErr) {
        console.warn(`[PAYMASTER EXECUTOR] ⚠️ Pre-flight simulation failed (${simErr.shortMessage || simErr.message}). Skipping this tick to prevent revert.`);
        return { success: false, executedCount: 0, details: executionDetails, message: 'Simulation reverted' };
    }

    // 7. Broadcast sponsored UserOperation via Coinbase Paymaster
    console.log(`[PAYMASTER EXECUTOR] Broadcasting sponsored batch of ${executableTradeIds.length} trade(s)...`);
    const txHash = await sendGaslessTransaction({
        to: coreAddress,
        data: encodedData,
        value: 10n
    }, { network: netConfig.network });

    const explorerUrl = netConfig.isMainnet ? `https://basescan.org/tx/${txHash}` : `https://sepolia.basescan.org/tx/${txHash}`;
    console.log(`🎉 [SUCCESS] Gasless Execution Tx: ${explorerUrl}`);
    console.log('='.repeat(80) + '\n');

    return {
        success: true,
        txHash,
        executedCount: executableTradeIds.length,
        details: executionDetails
    };
}

module.exports = {
    REASON,
    evaluateOnChainTrade,
    executeTradesGasless
};
