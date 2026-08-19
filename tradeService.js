const fs = require('fs');
const path = require('path');
const { getNetworkConfig } = require('./config');

const DIRECTION_MAP = {
    '0': 'SHORT',
    '1': 'LONG'
};

const ORDER_TYPE_MAP = {
    '0': 'MARKET',
    '1': 'LIMIT',
    '2': 'STOP'
};

const CLOSE_METHOD_MAP = {
    '0': 'MARKET',
    '1': 'STOP_LOSS',
    '2': 'TAKE_PROFIT',
    '3': 'LIQUIDATION'
};

function reconstructTrades(events) {
    const trades = {};

    const sortedEvents = [...events].sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber - b.blockNumber;
        }
        return a.logIndex - b.logIndex;
    });

    for (const ev of sortedEvents) {
        const tradeId = ev.args.tradeId;
        if (!tradeId) continue;

        if (!trades[tradeId]) {
            trades[tradeId] = {
                tradeId: tradeId,
                trader: null,
                direction: null,
                directionName: null,
                orderType: null,
                orderTypeName: null,
                leverage: null,
                status: 'UNKNOWN',
                collateral: null,
                targetPrice: null,
                margin: null,
                openInterest: null,
                openTimestamp: null,
                executionPriceOpen: null,
                oraclePriceOpen: null,
                borrowIndexAtOpen: null,
                longSpread: null,
                shortSpread: null,
                currentStopLoss: null,
                currentTakeProfit: null,
                closedAt: null,
                executionPriceClose: null,
                oraclePriceClose: null,
                finalPnl: null,
                closeMethod: null,
                closeMethodName: null,
                borrowFee: null,
                closingFee: null,
                isRecovered: false,
                recoveredTo: null,
                isCancelled: false,
                createdAt: null,
                openedAt: null,
                lastUpdatedAt: null,
                creationBlock: null,
                openingBlock: null,
                closingBlock: null
            };
        }

        const t = trades[tradeId];
        t.lastUpdatedAt = ev.timestamp;

        switch (ev.event) {
            case 'TradeCreated': {
                t.trader = ev.args.trader;
                t.direction = ev.args.direction;
                t.directionName = DIRECTION_MAP[ev.args.direction] || 'UNKNOWN';
                t.orderType = ev.args.orderType;
                t.orderTypeName = ORDER_TYPE_MAP[ev.args.orderType] || 'UNKNOWN';
                t.leverage = ev.args.leverage;
                t.collateral = ev.args.collateral;
                t.targetPrice = ev.args.targetPrice;
                t.status = 'CREATED';
                t.createdAt = ev.timestamp;
                t.creationBlock = ev.blockNumber;
                break;
            }

            case 'TradeOpened': {
                t.trader = ev.args.trader;
                t.direction = ev.args.direction;
                t.directionName = DIRECTION_MAP[ev.args.direction] || 'UNKNOWN';
                t.orderType = ev.args.orderType;
                t.orderTypeName = ORDER_TYPE_MAP[ev.args.orderType] || 'UNKNOWN';
                t.leverage = ev.args.leverage;
                t.margin = ev.args.margin;
                t.openInterest = ev.args.openInterest;
                t.openTimestamp = ev.args.openTimestamp;
                t.executionPriceOpen = ev.args.executionPrice;
                t.oraclePriceOpen = ev.args.oraclePrice;
                t.borrowIndexAtOpen = ev.args.borrowIndexAtOpen;
                t.longSpread = ev.args.longSpread;
                t.shortSpread = ev.args.shortSpread;
                t.status = 'OPEN';
                t.openedAt = ev.timestamp;
                t.openingBlock = ev.blockNumber;
                break;
            }

            case 'StopsChanged': {
                t.currentStopLoss = ev.args.stopLoss;
                t.currentTakeProfit = ev.args.takeProfit;
                break;
            }

            case 'OrderCancelled': {
                t.status = 'CANCELLED';
                t.isCancelled = true;
                break;
            }

            case 'TradeRecovered': {
                t.isRecovered = true;
                t.recoveredTo = ev.args.to;
                break;
            }

            case 'TradeClosed': {
                t.status = 'CLOSED';
                t.closedAt = ev.timestamp;
                t.closingBlock = ev.blockNumber;
                t.executionPriceClose = ev.args.executionPrice;
                t.oraclePriceClose = ev.args.oraclePrice;
                t.finalPnl = ev.args.pnl;
                t.closeMethod = ev.args.method;
                t.closeMethodName = CLOSE_METHOD_MAP[ev.args.method] || 'UNKNOWN';
                t.borrowFee = ev.args.borrowFee;
                t.closingFee = ev.args.closingFee;
                break;
            }
        }
    }

    return trades;
}

function updateTradesDatabase(network) {
    const config = getNetworkConfig(network);

    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }

    if (!fs.existsSync(config.eventsFile)) {
        return {};
    }

    try {
        const eventsData = JSON.parse(fs.readFileSync(config.eventsFile, 'utf8'));
        const trades = reconstructTrades(eventsData.events || []);

        fs.writeFileSync(config.tradesFile, JSON.stringify(trades, null, 2), 'utf8');
        return trades;
    } catch (err) {
        console.error(`[ERROR] Failed to update trades database (${config.network}): ${err.message}`);
        return {};
    }
}

function getTradeById(tradeId, network) {
    const trades = updateTradesDatabase(network);
    return trades[tradeId] || null;
}

function getTradesByStatus(status, network) {
    const trades = updateTradesDatabase(network);
    return Object.values(trades).filter(t => t.status === status);
}

function getRecentTrades(limit = 50, network) {
    const trades = updateTradesDatabase(network);
    return Object.values(trades)
        .sort((a, b) => {
            const timeA = parseInt(a.lastUpdatedAt || a.closedAt || a.openedAt || a.createdAt || '0');
            const timeB = parseInt(b.lastUpdatedAt || b.closedAt || b.openedAt || b.createdAt || '0');
            return timeB - timeA;
        })
        .slice(0, limit);
}

module.exports = {
    reconstructTrades,
    updateTradesDatabase,
    getTradeById,
    getTradesByStatus,
    getRecentTrades
};
