#!/usr/bin/env node

/**
 * CLI script to query CumulativeVolumeIncreased events and total volume for a trader.
 * Usage:
 *   node getTraderVolume.js 0xC81db5107BB6e6782BBc3941938D72884CC2BFEf
 */

const { getTraderVolume, updateVolumeDatabase } = require('./volumeService');

const traderAddress = process.argv[2];

if (!traderAddress) {
    console.log('Usage: node getTraderVolume.js <traderAddress>');
    process.exit(1);
}

// Refresh database from events
updateVolumeDatabase();

const info = getTraderVolume(traderAddress);

console.log('='.repeat(70));
console.log(`CUMULATIVE VOLUME REPORT: ${traderAddress}`);
console.log('='.repeat(70));
console.log(`Total Cumulative Volume : ${(Number(info.totalVolume) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDC`);
console.log(`Total Trades Counted    : ${info.tradesCount}`);
console.log('-'.repeat(70));

console.log(`\n[VOLUME INCREASE EVENTS (${info.events.length})]:`);
if (info.events.length === 0) {
    console.log('  No CumulativeVolumeIncreased events found for this address.');
} else {
    info.events.forEach((ev, i) => {
        const added = (Number(ev.addedVolume) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const total = (Number(ev.totalVolume) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2 });
        const date = ev.timestamp ? new Date(ev.timestamp * 1000).toISOString() : 'N/A';
        console.log(`  #${i + 1} | Trade #${ev.tradeId} | Added: +${added} USDC | Cumulative: ${total} USDC | Date: ${date} | Tx: ${ev.transactionHash}`);
    });
}
console.log('='.repeat(70));
