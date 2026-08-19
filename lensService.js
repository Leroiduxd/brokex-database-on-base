/**
 * Brokex Lens Service
 *
 * Calls getProtocolInfo() on the BrokexLens smart contract and writes the latest
 * protocol snapshot to data/<network>/protocolInfo.json (overwriting previous snapshot so only
 * the most recent state is kept).
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { getNetworkConfig } = require('./config');

const LENS_ABI = [
    {
        "inputs": [
            { "name": "tradeIds", "type": "uint256[]" }
        ],
        "name": "getTradesByIds",
        "outputs": [
            {
                "components": [
                    { "name": "trader", "type": "address" },
                    { "name": "openTimestamp", "type": "uint40" },
                    { "name": "state", "type": "uint8" },
                    { "name": "direction", "type": "uint8" },
                    { "name": "orderType", "type": "uint8" },
                    { "name": "leverage", "type": "uint8" },
                    { "name": "margin", "type": "uint64" },
                    { "name": "price", "type": "uint64" },
                    { "name": "stopLoss", "type": "uint64" },
                    { "name": "takeProfit", "type": "uint64" },
                    { "name": "borrowIndexAtOpen", "type": "uint128" }
                ],
                "name": "result",
                "type": "tuple[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "name": "tradeIds", "type": "uint256[]" }
        ],
        "name": "getLiquidationsByIds",
        "outputs": [
            {
                "components": [
                    { "name": "exists", "type": "bool" },
                    { "name": "open", "type": "bool" },
                    { "name": "liquidationPrice", "type": "uint256" },
                    { "name": "borrowFee", "type": "uint256" }
                ],
                "name": "result",
                "type": "tuple[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getProtocolInfo",
        "outputs": [
            {
                "components": [
                    { "name": "owner", "type": "address" },
                    { "name": "pendingOwner", "type": "address" },
                    { "name": "riskManager", "type": "address" },
                    { "name": "usdc", "type": "address" },
                    { "name": "pyth", "type": "address" },
                    { "name": "vault", "type": "address" },
                    { "name": "priceFeedId", "type": "bytes32" },
                    { "name": "minLeverage", "type": "uint256" },
                    { "name": "maxLeverage", "type": "uint256" },
                    { "name": "minTradeSize", "type": "uint256" },
                    { "name": "commissionRate", "type": "uint256" },
                    { "name": "baseBorrowRateHourly", "type": "uint256" },
                    { "name": "maxBorrowRateHourly", "type": "uint256" },
                    { "name": "maxSkewBorrowRateHourly", "type": "uint256" },
                    { "name": "currentLongBorrowRate", "type": "uint256" },
                    { "name": "currentShortBorrowRate", "type": "uint256" },
                    { "name": "currentLongSpread", "type": "uint256" },
                    { "name": "currentShortSpread", "type": "uint256" },
                    { "name": "lockedCapitalRate", "type": "uint256" },
                    { "name": "maxProfitRate", "type": "uint256" },
                    { "name": "liquidationThreshold", "type": "uint256" },
                    { "name": "maxTraderOI", "type": "uint256" },
                    { "name": "maxOpenInterest", "type": "uint256" },
                    { "name": "openInterestLong", "type": "uint256" },
                    { "name": "openInterestShort", "type": "uint256" },
                    { "name": "averageEntryPriceLong", "type": "uint256" },
                    { "name": "averageEntryPriceShort", "type": "uint256" },
                    { "name": "lockedCapital", "type": "uint256" },
                    { "name": "vaultBalance", "type": "uint256" },
                    { "name": "longBorrowIndex", "type": "uint256" },
                    { "name": "shortBorrowIndex", "type": "uint256" },
                    { "name": "currentLongBorrowIndex", "type": "uint256" },
                    { "name": "currentShortBorrowIndex", "type": "uint256" },
                    { "name": "lastBorrowUpdate", "type": "uint256" },
                    { "name": "latestTradeId", "type": "uint256" },
                    { "name": "securityMode", "type": "uint8" }
                ],
                "name": "info",
                "type": "tuple"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

let lastSyncedBlock = {};
let isUpdating = {};

async function fetchPythFeedMetadata(priceFeedId) {
    if (!priceFeedId) return null;
    
    // Normalize clean hex id without 0x
    const cleanId = priceFeedId.startsWith('0x') ? priceFeedId.slice(2) : priceFeedId;
    const url = `https://benchmarks.pyth.network/v1/price_feeds/${cleanId}`;

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();
        const attr = data.attributes || {};

        return {
            symbol: attr.symbol || null,
            asset_type: attr.asset_type || null,
            description: attr.description || null,
            display_symbol: attr.display_symbol || null,
            country: attr.country || null,
            quote_currency: attr.quote_currency || null,
            base: attr.base || null,
            schedule: attr.schedule || null,
            market_hours: attr.market_hours || null
        };
    } catch {
        return null;
    }
}

function serializeInfo(info, blockNumber, pythMetadata = null, volume24h = null, market24h = null) {
    return {
        syncedAt: new Date().toISOString(),
        blockNumber: Number(blockNumber),
        owner: info.owner,
        pendingOwner: info.pendingOwner,
        riskManager: info.riskManager,
        usdc: info.usdc,
        pyth: info.pyth,
        vault: info.vault,
        priceFeedId: info.priceFeedId,
        pythMetadata: pythMetadata,
        volume24h: volume24h || null,
        market24h: market24h || null,
        minLeverage: info.minLeverage.toString(),
        maxLeverage: info.maxLeverage.toString(),
        minTradeSize: info.minTradeSize.toString(),
        commissionRate: info.commissionRate.toString(),
        baseBorrowRateHourly: info.baseBorrowRateHourly.toString(),
        maxBorrowRateHourly: info.maxBorrowRateHourly.toString(),
        maxSkewBorrowRateHourly: info.maxSkewBorrowRateHourly.toString(),
        currentLongBorrowRate: info.currentLongBorrowRate.toString(),
        currentShortBorrowRate: info.currentShortBorrowRate.toString(),
        currentLongSpread: info.currentLongSpread.toString(),
        currentShortSpread: info.currentShortSpread.toString(),
        lockedCapitalRate: info.lockedCapitalRate.toString(),
        maxProfitRate: info.maxProfitRate.toString(),
        liquidationThreshold: info.liquidationThreshold.toString(),
        maxTraderOI: info.maxTraderOI.toString(),
        maxOpenInterest: info.maxOpenInterest.toString(),
        openInterestLong: info.openInterestLong.toString(),
        openInterestShort: info.openInterestShort.toString(),
        averageEntryPriceLong: info.averageEntryPriceLong.toString(),
        averageEntryPriceShort: info.averageEntryPriceShort.toString(),
        lockedCapital: info.lockedCapital.toString(),
        vaultBalance: info.vaultBalance.toString(),
        longBorrowIndex: info.longBorrowIndex.toString(),
        shortBorrowIndex: info.shortBorrowIndex.toString(),
        currentLongBorrowIndex: info.currentLongBorrowIndex.toString(),
        currentShortBorrowIndex: info.currentShortBorrowIndex.toString(),
        lastBorrowUpdate: info.lastBorrowUpdate.toString(),
        latestTradeId: info.latestTradeId.toString(),
        securityMode: Number(info.securityMode)
    };
}

const { calculate24hVolume } = require('./get24hVolume');
const { getLatestSparklineData } = require('./chart/sparklineService');

async function updateProtocolInfo(provider, blockNumber = null, network) {
    const config = getNetworkConfig(network);
    const netKey = config.network;

    if (isUpdating[netKey]) return null;

    const lensAddress = config.lensAddress;
    if (!lensAddress) {
        console.warn(`[LENS] BROKEX_LENS_ADDRESS not configured for ${netKey}`);
        return null;
    }

    if (blockNumber && blockNumber <= (lastSyncedBlock[netKey] || 0)) {
        return null;
    }

    isUpdating[netKey] = true;

    try {
        const rpcProvider = provider || new ethers.JsonRpcProvider(config.rpcUrl);
        const contract = new ethers.Contract(lensAddress, LENS_ABI, rpcProvider);
        
        const info = await contract.getProtocolInfo();
        const pythFeedData = await fetchPythFeedMetadata(info.priceFeedId);

        const currentBlock = blockNumber || await rpcProvider.getBlockNumber();
        lastSyncedBlock[netKey] = currentBlock;

        // Calculate 24h volume metrics for this network
        let volume24h = null;
        try {
            const volReport = calculate24hVolume(netKey);
            volume24h = {
                totalVolumeRaw: volReport.totalVolumeRaw,
                totalVolumeFormatted: volReport.totalVolumeFormatted,
                opened: volReport.breakdown.opened,
                closed: volReport.breakdown.closed
            };
        } catch (volErr) {
            console.warn(`[LENS] Failed to calculate 24h volume: ${volErr.message}`);
        }

        // Get latest 24h market & chart prices stats
        let market24h = null;
        try {
            const chartData = getLatestSparklineData();
            if (chartData) {
                market24h = {
                    symbol: chartData.symbol,
                    current_price: chartData.current_price,
                    high_24h: chartData.high_24h,
                    low_24h: chartData.low_24h,
                    open_24h: chartData.open_24h,
                    price_change_24h: chartData.price_change_24h,
                    price_change_percent_24h: chartData.price_change_percent_24h,
                    hour_price_diff_decimal: chartData.hour_price_diff_decimal,
                    day_price_diff_decimal: chartData.day_price_diff_decimal,
                    week_price_diff_decimal: chartData.week_price_diff_decimal,
                    month_price_diff_decimal: chartData.month_price_diff_decimal,
                    sparkline: chartData.sparkline
                };
            }
        } catch (chartErr) {
            console.warn(`[LENS] Failed to read 24h market stats: ${chartErr.message}`);
        }

        const serialized = serializeInfo(info, currentBlock, pythFeedData, volume24h, market24h);

        if (!fs.existsSync(config.dataDir)) {
            fs.mkdirSync(config.dataDir, { recursive: true });
        }

        fs.writeFileSync(config.protocolInfoFile, JSON.stringify(serialized, null, 2), 'utf8');
        return serialized;
    } catch (err) {
        console.error(`[LENS ERROR] Failed to fetch protocol info (${netKey}): ${err.message}`);
        return null;
    } finally {
        isUpdating[netKey] = false;
    }
}

function getLatestProtocolInfo(network) {
    const config = getNetworkConfig(network);
    if (fs.existsSync(config.protocolInfoFile)) {
        try {
            return JSON.parse(fs.readFileSync(config.protocolInfoFile, 'utf8'));
        } catch {
            return null;
        }
    }
    return null;
}

async function getTradesByIds(tradeIds, provider, network) {
    if (!tradeIds || tradeIds.length === 0) return [];
    const config = getNetworkConfig(network);
    const lensAddress = config.lensAddress;
    if (!lensAddress) return [];
    const rpcProvider = provider || new ethers.JsonRpcProvider(config.rpcUrl);
    const contract = new ethers.Contract(lensAddress, LENS_ABI, rpcProvider);
    const bigIds = tradeIds.map(id => BigInt(id));
    return await contract.getTradesByIds(bigIds);
}

async function getLiquidationsByIds(tradeIds, provider, network) {
    if (!tradeIds || tradeIds.length === 0) return [];
    const config = getNetworkConfig(network);
    const lensAddress = config.lensAddress;
    if (!lensAddress) return [];
    const rpcProvider = provider || new ethers.JsonRpcProvider(config.rpcUrl);
    const contract = new ethers.Contract(lensAddress, LENS_ABI, rpcProvider);
    const bigIds = tradeIds.map(id => BigInt(id));
    return await contract.getLiquidationsByIds(bigIds);
}

module.exports = {
    updateProtocolInfo,
    getLatestProtocolInfo,
    fetchPythFeedMetadata,
    getTradesByIds,
    getLiquidationsByIds,
    LENS_ABI
};
