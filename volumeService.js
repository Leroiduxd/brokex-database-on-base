const fs = require('fs');
const path = require('path');
const { getNetworkConfig } = require('./config');

function reconstructVolumeData(events = []) {
    const data = {
        updatedAt: new Date().toISOString(),
        totalGlobalVolume: "0",
        traders: {}
    };

    let globalVolumeBigInt = 0n;

    function getOrCreateProfile(addr) {
        if (!addr) return null;
        const normalized = addr.toLowerCase();
        if (!data.traders[normalized]) {
            data.traders[normalized] = {
                address: addr,
                totalVolume: "0",
                tradesCount: 0,
                events: []
            };
        }
        return data.traders[normalized];
    }

    const sortedEvents = [...events].sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber - b.blockNumber;
        }
        return a.logIndex - b.logIndex;
    });

    for (const ev of sortedEvents) {
        if (ev.event === 'CumulativeVolumeIncreased' || ev.event === 'TraderEpochVolumeIncreased') {
            const traderAddr = ev.args.trader;
            const tradeId = ev.args.tradeId;
            const volumeStr = ev.args.addedVolume || "0";
            const volumeBig = BigInt(volumeStr);
            const timestamp = parseInt(ev.timestamp);
            const epoch = ev.args.epoch ? ev.args.epoch.toString() : null;

            globalVolumeBigInt += volumeBig;

            const profile = getOrCreateProfile(traderAddr);
            if (profile) {
                const currentTraderVol = BigInt(profile.totalVolume);
                profile.totalVolume = (currentTraderVol + volumeBig).toString();
                profile.tradesCount += 1;

                profile.events.push({
                    eventName: ev.event,
                    tradeId,
                    epoch,
                    addedVolume: volumeStr,
                    totalVolume: profile.totalVolume,
                    timestamp,
                    txHash: ev.transactionHash,
                    blockNumber: ev.blockNumber
                });
            }
        }
    }

    data.totalGlobalVolume = globalVolumeBigInt.toString();
    return data;
}

function updateVolumeDatabase(network) {
    const config = getNetworkConfig(network);

    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }

    if (!fs.existsSync(config.eventsFile)) {
        return { updatedAt: new Date().toISOString(), totalGlobalVolume: "0", traders: {} };
    }

    try {
        const eventsData = JSON.parse(fs.readFileSync(config.eventsFile, 'utf8'));
        const volumeDb = reconstructVolumeData(eventsData.events || []);

        fs.writeFileSync(config.volumeFile, JSON.stringify(volumeDb, null, 2), 'utf8');
        return volumeDb;
    } catch (err) {
        console.error(`[ERROR] Failed to update cumulative volume database (${config.network}): ${err.message}`);
        return { updatedAt: new Date().toISOString(), totalGlobalVolume: "0", traders: {} };
    }
}

function getTraderVolume(traderAddress, network) {
    const volumeDb = updateVolumeDatabase(network);
    if (!traderAddress) return null;
    const normalized = traderAddress.toLowerCase();
    return volumeDb.traders[normalized] || {
        address: traderAddress,
        totalVolume: "0",
        tradesCount: 0,
        events: []
    };
}

module.exports = {
    reconstructVolumeData,
    updateVolumeDatabase,
    getTraderVolume
};
