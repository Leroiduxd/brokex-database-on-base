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
                closingBlock: null,
                creationTxHash: null,
                openingTxHash: null,
                closingTxHash: null,
                cancellationTxHash: null,
                txHashes: [],
                events: []
            };
        }

        const t = trades[tradeId];
        t.lastUpdatedAt = ev.timestamp;

        if (ev.transactionHash && !t.txHashes.includes(ev.transactionHash)) {
            t.txHashes.push(ev.transactionHash);
        }

        t.events.push({
            event: ev.event,
            blockNumber: ev.blockNumber,
            transactionHash: ev.transactionHash,
            timestamp: ev.timestamp,
            args: ev.args
        });

        switch (ev.event) {
            case 'TradeCreated': {
                if (ev.args.trader) t.trader = ev.args.trader;
                if (ev.args.direction !== undefined) {
                    t.direction = ev.args.direction;
                    t.directionName = DIRECTION_MAP[ev.args.direction] || 'UNKNOWN';
                }
                if (ev.args.orderType !== undefined) {
                    t.orderType = ev.args.orderType;
                    t.orderTypeName = ORDER_TYPE_MAP[ev.args.orderType] || 'UNKNOWN';
                }
                if (ev.args.leverage !== undefined) t.leverage = ev.args.leverage;
                if (ev.args.collateral !== undefined) t.collateral = ev.args.collateral;
                if (ev.args.targetPrice !== undefined) t.targetPrice = ev.args.targetPrice;
                if (ev.args.stopLoss !== undefined) t.currentStopLoss = ev.args.stopLoss;
                if (ev.args.takeProfit !== undefined) t.currentTakeProfit = ev.args.takeProfit;
                t.status = 'CREATED';
                t.createdAt = ev.timestamp;
                t.creationBlock = ev.blockNumber;
                t.creationTxHash = ev.transactionHash;
                break;
            }

            case 'TradeOpened': {
                if (ev.args.trader) t.trader = ev.args.trader;
                if (ev.args.direction !== undefined) {
                    t.direction = ev.args.direction;
                    t.directionName = DIRECTION_MAP[ev.args.direction] || 'UNKNOWN';
                }
                if (ev.args.orderType !== undefined) {
                    t.orderType = ev.args.orderType;
                    t.orderTypeName = ORDER_TYPE_MAP[ev.args.orderType] || 'UNKNOWN';
                }
                if (ev.args.leverage !== undefined) t.leverage = ev.args.leverage;
                if (ev.args.margin !== undefined) t.margin = ev.args.margin;
                if (ev.args.openInterest !== undefined) t.openInterest = ev.args.openInterest;
                if (ev.args.openedAt !== undefined || ev.args.openTimestamp !== undefined) {
                    t.openTimestamp = ev.args.openedAt || ev.args.openTimestamp;
                }
                if (ev.args.executionPrice !== undefined) t.executionPriceOpen = ev.args.executionPrice;
                if (ev.args.oraclePrice !== undefined) t.oraclePriceOpen = ev.args.oraclePrice;
                if (ev.args.borrowIndexAtOpen !== undefined) t.borrowIndexAtOpen = ev.args.borrowIndexAtOpen;
                if (ev.args.longSpread !== undefined) t.longSpread = ev.args.longSpread;
                if (ev.args.shortSpread !== undefined) t.shortSpread = ev.args.shortSpread;
                t.status = 'OPEN';
                t.openedAt = ev.timestamp;
                t.openingBlock = ev.blockNumber;
                t.openingTxHash = ev.transactionHash;
                break;
            }

            case 'StopsChanged': {
                if (ev.args.stopLoss !== undefined) t.currentStopLoss = ev.args.stopLoss;
                if (ev.args.takeProfit !== undefined) t.currentTakeProfit = ev.args.takeProfit;
                break;
            }

            case 'OrderCancelled': {
                t.status = 'CANCELLED';
                t.isCancelled = true;
                t.cancellationTxHash = ev.transactionHash;
                break;
            }

            case 'TradeRecovered': {
                t.isRecovered = true;
                if (ev.args.to) t.recoveredTo = ev.args.to;
                break;
            }

            case 'TradeClosed': {
                t.status = 'CLOSED';
                t.closedAt = ev.timestamp;
                t.closingBlock = ev.blockNumber;
                t.closingTxHash = ev.transactionHash;
                if (ev.args.executionPrice !== undefined) t.executionPriceClose = ev.args.executionPrice;
                if (ev.args.oraclePrice !== undefined) t.oraclePriceClose = ev.args.oraclePrice;
                if (ev.args.finalPnl !== undefined) t.finalPnl = ev.args.finalPnl;
                else if (ev.args.pnl !== undefined) t.finalPnl = ev.args.pnl;
                if (ev.args.closeMethod !== undefined) {
                    t.closeMethod = ev.args.closeMethod;
                    t.closeMethodName = CLOSE_METHOD_MAP[ev.args.closeMethod] || 'UNKNOWN';
                } else if (ev.args.method !== undefined) {
                    t.closeMethod = ev.args.method;
                    t.closeMethodName = CLOSE_METHOD_MAP[ev.args.method] || 'UNKNOWN';
                }
                if (ev.args.borrowFeePaid !== undefined) t.borrowFee = ev.args.borrowFeePaid;
                else if (ev.args.borrowFee !== undefined) t.borrowFee = ev.args.borrowFee;
                if (ev.args.closingFee !== undefined) t.closingFee = ev.args.closingFee;
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
