/**
 * 24h Protocol Volume Calculator
 *
 * Calculates the protocol volume over the last 24 hours based on:
 * - TradeOpened events within the last 24h (+ openInterest)
 * - TradeClosed events within the last 24h (+ openInterest of the corresponding trade)
 *
 * Rules:
 * - If a trade was opened AND closed in the last 24h -> counted 2x (Open + Close).
 * - If only opened in the last 24h -> counted 1x.
 * - If only closed in the last 24h -> counted 1x.
 */

const fs = require('fs');
const path = require('path');
const { getNetworkConfig, resolveNetwork } = require('./config');

const SECONDS_IN_24H = 24 * 60 * 60; // 86400 seconds

/**
 * Calculates 24h volume for a specific network.
 * @param {string} [networkInput] - 'testnet' | 'mainnet'
 * @param {number} [customNowSeconds] - Optional timestamp for testing
 */
function calculate24hVolume(networkInput, customNowSeconds = null) {
    const netConfig = getNetworkConfig(networkInput);
    const network = netConfig.network;

    const defaultResult = {
        network,
        now: customNowSeconds || Math.floor(Date.now() / 1000),
        windowStart: (customNowSeconds || Math.floor(Date.now() / 1000)) - SECONDS_IN_24H,
        totalVolumeRaw: "0",
        totalVolumeFormatted: "0.00 USDC",
        breakdown: {
            opened: {
                totalCount: 0,
                totalVolumeRaw: "0",
                totalVolumeFormatted: "0.00 USDC",
                longCount: 0,
                longVolumeRaw: "0",
                longVolumeFormatted: "0.00 USDC",
                shortCount: 0,
                shortVolumeRaw: "0",
                shortVolumeFormatted: "0.00 USDC"
            },
            closed: {
                totalCount: 0,
                totalVolumeRaw: "0",
                totalVolumeFormatted: "0.00 USDC",
                longCount: 0,
                longVolumeRaw: "0",
                longVolumeFormatted: "0.00 USDC",
                shortCount: 0,
                shortVolumeRaw: "0",
                shortVolumeFormatted: "0.00 USDC"
            }
        },
        details: []
    };

    if (!fs.existsSync(netConfig.eventsFile)) {
        return defaultResult;
    }

    const eventsData = JSON.parse(fs.readFileSync(netConfig.eventsFile, 'utf8'));
    const events = eventsData.events || [];

    // Map trade metadata (openInterest & direction) by tradeId
    const tradeMetaMap = new Map(); // tradeId -> { openInterest: BigInt, direction: 'LONG'|'SHORT' }

    for (const ev of events) {
        if (!ev.args || !ev.args.tradeId) continue;
        const tradeId = ev.args.tradeId.toString();

        if (!tradeMetaMap.has(tradeId)) {
            tradeMetaMap.set(tradeId, { openInterest: 0n, direction: 'UNKNOWN' });
        }

        const meta = tradeMetaMap.get(tradeId);

        if (ev.event === 'TradeCreated' && ev.args.direction !== undefined) {
            meta.direction = ev.args.direction.toString() === '1' ? 'LONG' : (ev.args.direction.toString() === '0' ? 'SHORT' : 'UNKNOWN');
        }

        if (ev.event === 'TradeOpened') {
            if (ev.args.openInterest) meta.openInterest = BigInt(ev.args.openInterest);
            if (ev.args.direction !== undefined) {
                meta.direction = ev.args.direction.toString() === '1' ? 'LONG' : (ev.args.direction.toString() === '0' ? 'SHORT' : 'UNKNOWN');
            }
        }
    }

    // Determine current time and 24h cutoff
    const now = customNowSeconds !== null ? customNowSeconds : Math.floor(Date.now() / 1000);
    const cutoff24h = now - SECONDS_IN_24H;

    let openedLongVol = 0n, openedShortVol = 0n;
    let closedLongVol = 0n, closedShortVol = 0n;
    let openedLongCount = 0, openedShortCount = 0;
    let closedLongCount = 0, closedShortCount = 0;

    const details = [];

    for (const ev of events) {
        const evTimestamp = parseInt(ev.timestamp || '0', 10);
        const isWithin24h = evTimestamp >= cutoff24h && evTimestamp <= now;

        if (!isWithin24h) continue;

        if (ev.event === 'TradeOpened') {
            const tradeId = ev.args.tradeId ? ev.args.tradeId.toString() : null;
            const oi = ev.args.openInterest ? BigInt(ev.args.openInterest) : 0n;
            const meta = tradeId ? tradeMetaMap.get(tradeId) : null;
            const direction = meta?.direction || (ev.args.direction === '1' ? 'LONG' : (ev.args.direction === '0' ? 'SHORT' : 'UNKNOWN'));

            if (direction === 'LONG') {
                openedLongVol += oi;
                openedLongCount++;
            } else {
                openedShortVol += oi;
                openedShortCount++;
            }

            details.push({
                type: 'OPEN',
                direction,
                tradeId,
                openInterestRaw: oi.toString(),
                openInterestFormatted: (Number(oi) / 1e6).toFixed(2) + ' USDC',
                timestamp: evTimestamp,
                dateIso: new Date(evTimestamp * 1000).toISOString(),
                txHash: ev.transactionHash
            });
        }

        if (ev.event === 'TradeClosed') {
            const tradeId = ev.args.tradeId ? ev.args.tradeId.toString() : null;
            const meta = tradeId ? tradeMetaMap.get(tradeId) : null;
            const oi = meta?.openInterest || 0n;
            const direction = meta?.direction || 'UNKNOWN';

            if (direction === 'LONG') {
                closedLongVol += oi;
                closedLongCount++;
            } else {
                closedShortVol += oi;
                closedShortCount++;
            }

            details.push({
                type: 'CLOSE',
                direction,
                tradeId,
                openInterestRaw: oi.toString(),
                openInterestFormatted: (Number(oi) / 1e6).toFixed(2) + ' USDC',
                timestamp: evTimestamp,
                dateIso: new Date(evTimestamp * 1000).toISOString(),
                txHash: ev.transactionHash
            });
        }
    }

    const totalOpenedVol = openedLongVol + openedShortVol;
    const totalClosedVol = closedLongVol + closedShortVol;
    const totalVol = totalOpenedVol + totalClosedVol;

    return {
        network,
        now,
        nowIso: new Date(now * 1000).toISOString(),
        cutoff24h,
        cutoff24hIso: new Date(cutoff24h * 1000).toISOString(),
        totalVolumeRaw: totalVol.toString(),
        totalVolumeFormatted: (Number(totalVol) / 1e6).toFixed(2) + ' USDC',
        breakdown: {
            opened: {
                totalCount: openedLongCount + openedShortCount,
                totalVolumeRaw: totalOpenedVol.toString(),
                totalVolumeFormatted: (Number(totalOpenedVol) / 1e6).toFixed(2) + ' USDC',
                longCount: openedLongCount,
                longVolumeRaw: openedLongVol.toString(),
                longVolumeFormatted: (Number(openedLongVol) / 1e6).toFixed(2) + ' USDC',
                shortCount: openedShortCount,
                shortVolumeRaw: openedShortVol.toString(),
                shortVolumeFormatted: (Number(openedShortVol) / 1e6).toFixed(2) + ' USDC'
            },
            closed: {
                totalCount: closedLongCount + closedShortCount,
                totalVolumeRaw: totalClosedVol.toString(),
                totalVolumeFormatted: (Number(totalClosedVol) / 1e6).toFixed(2) + ' USDC',
                longCount: closedLongCount,
                longVolumeRaw: closedLongVol.toString(),
                longVolumeFormatted: (Number(closedLongVol) / 1e6).toFixed(2) + ' USDC',
                shortCount: closedShortCount,
                shortVolumeRaw: closedShortVol.toString(),
                shortVolumeFormatted: (Number(closedShortVol) / 1e6).toFixed(2) + ' USDC'
            }
        },
        details
    };
}

if (require.main === module) {
    const netArg = process.argv[2] || 'testnet';
    const result = calculate24hVolume(netArg);

    console.log('='.repeat(75));
    console.log(`📊 24H PROTOCOL VOLUME REPORT [${result.network.toUpperCase()}]`);
    console.log('='.repeat(75));
    console.log(`Current Time (UTC)   : ${result.nowIso} (${result.now})`);
    console.log(`24h Window Start     : ${result.cutoff24hIso} (${result.cutoff24h})`);
    console.log(`-`.repeat(75));
    console.log(`Trades Opened (24h)  : ${result.breakdown.opened.totalCount} (${result.breakdown.opened.totalVolumeFormatted})`);
    console.log(`  └─ Long Opens      : ${result.breakdown.opened.longCount} (${result.breakdown.opened.longVolumeFormatted})`);
    console.log(`  └─ Short Opens     : ${result.breakdown.opened.shortCount} (${result.breakdown.opened.shortVolumeFormatted})`);
    console.log(`Trades Closed (24h)  : ${result.breakdown.closed.totalCount} (${result.breakdown.closed.totalVolumeFormatted})`);
    console.log(`  └─ Long Closes     : ${result.breakdown.closed.longCount} (${result.breakdown.closed.longVolumeFormatted})`);
    console.log(`  └─ Short Closes    : ${result.breakdown.closed.shortCount} (${result.breakdown.closed.shortVolumeFormatted})`);
    console.log(`-`.repeat(75));
    console.log(`🔥 TOTAL 24H VOLUME  : ${result.totalVolumeFormatted} (${result.totalVolumeRaw} units)`);
    console.log('='.repeat(75));

    if (result.details.length > 0) {
        console.log('\n📜 24h Action Details:');
        result.details.forEach((item, index) => {
            console.log(`  [#${index + 1}] [${item.type} ${item.direction}] Trade #${item.tradeId} | OI: ${item.openInterestFormatted} | Time: ${item.dateIso} | Tx: ${item.txHash.slice(0, 10)}...`);
        });
    } else {
        console.log('\nℹ️ No TradeOpened or TradeClosed events in the last 24 hours.');
    }
}

module.exports = {
    calculate24hVolume
};
