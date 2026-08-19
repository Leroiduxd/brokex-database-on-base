const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { updateTradesDatabase } = require('./tradeService');
const { updateReferralsDatabase } = require('./referralService');
const { updateVolumeDatabase } = require('./volumeService');
const { updateProtocolInfo } = require('./lensService');
const { getNetworkConfig } = require('./config');

const config = getNetworkConfig();

const RPC_URL = config.rpcUrl;
const CONTRACT_ADDRESS = config.coreAddress;
const DEPLOYMENT_BLOCK = config.deploymentBlock;
const BATCH_SIZE = config.batchSize;
const REQUEST_DELAY_MS = config.requestDelayMs;
const POLL_INTERVAL_MS = config.pollIntervalMs;
const NETWORK = config.network;

if (!RPC_URL) {
    console.error(`[ERROR] RPC_URL is not defined in .env for ${NETWORK}`);
    process.exit(1);
}
if (!CONTRACT_ADDRESS) {
    console.error(`[ERROR] BROKEX_CORE_ADDRESS is not defined in .env for ${NETWORK}`);
    process.exit(1);
}
if (isNaN(DEPLOYMENT_BLOCK)) {
    console.error(`[ERROR] DEPLOYMENT_BLOCK is not defined or invalid in .env for ${NETWORK}`);
    process.exit(1);
}

// File Paths
const DATA_DIR = config.dataDir;
const STATE_FILE = config.stateFile;
const EVENTS_FILE = config.eventsFile;
const ABI_FILE = path.join(__dirname, 'abi.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load ABI & Interface
const ABI = JSON.parse(fs.readFileSync(ABI_FILE, 'utf8'));
const iface = new ethers.Interface(ABI);
const ALLOWED_EVENTS = new Set(ABI.filter(item => item.type === 'event').map(item => item.name));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (err) {
            console.error(`[ERROR] Failed to read state.json, initializing fresh state: ${err.message}`);
        }
    }
    return {
        lastProcessedBlock: DEPLOYMENT_BLOCK - 1,
        processedRanges: []
    };
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
        console.error(`[ERROR] Failed to save state.json: ${err.message}`);
    }
}

function loadEvents() {
    if (fs.existsSync(EVENTS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
        } catch (err) {
            console.error(`[ERROR] Failed to read events.json, initializing fresh db: ${err.message}`);
        }
    }
    return {
        lastUpdated: new Date().toISOString(),
        totalEvents: 0,
        events: []
    };
}

function saveEvents(eventsDb) {
    try {
        eventsDb.lastUpdated = new Date().toISOString();
        eventsDb.totalEvents = eventsDb.events.length;
        fs.writeFileSync(EVENTS_FILE, JSON.stringify(eventsDb, null, 2), 'utf8');
    } catch (err) {
        console.error(`[ERROR] Failed to save events.json: ${err.message}`);
    }
}

function formatLog(log) {
    let parsed;
    try {
        parsed = iface.parseLog({
            topics: log.topics,
            data: log.data
        });
    } catch {
        return null;
    }

    if (!parsed || !ALLOWED_EVENTS.has(parsed.name)) {
        return null;
    }

    const formatted = {
        id: `${log.transactionHash}-${log.index}`,
        event: parsed.name,
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        args: {}
    };

    parsed.fragment.inputs.forEach((input, i) => {
        const val = parsed.args[i];
        if (typeof val === 'bigint') {
            formatted.args[input.name] = val.toString();
        } else {
            formatted.args[input.name] = val;
        }
    });

    return formatted;
}

async function fetchLogsWithRetry(provider, filter, maxRetries = 10) {
    let retries = 0;
    let currentFilter = { ...filter };

    while (retries < maxRetries) {
        try {
            return await provider.getLogs(currentFilter);
        } catch (error) {
            retries++;
            const msg = error.message || '';
            const isRateLimit = msg.includes('429') || error.code === -32005 || msg.includes('Too Many Requests');
            const isBackendUnhealthy = msg.includes('no backend is currently healthy') || error.code === -32011 || msg.includes('503');

            // Handle RPC node load-balancer lag ("block range extends beyond current head block")
            if (msg.includes('block range extends beyond current head block') || error.code === -32602) {
                try {
                    const freshHead = await provider.getBlockNumber();
                    if (freshHead < currentFilter.toBlock) {
                        currentFilter.toBlock = freshHead;
                    }
                    if (currentFilter.fromBlock > currentFilter.toBlock) {
                        return [];
                    }
                } catch {}
            }

            const waitTime = (isRateLimit || isBackendUnhealthy) ? Math.min(15000, 1500 * Math.pow(1.5, retries)) : 1000 * retries;
            console.warn(`[WARN] RPC Node glitch (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${Math.round(waitTime)}ms...`);
            await sleep(waitTime);
        }
    }
    console.warn(`[WARN] Skipped query range [${filter.fromBlock}..${filter.toBlock}] after ${maxRetries} attempts.`);
    return [];
}

async function processBlockRange(provider, fromBlock, toBlock, state, eventsDb, existingEventKeys) {
    const filter = {
        address: CONTRACT_ADDRESS,
        fromBlock,
        toBlock
    };

    const logs = await fetchLogsWithRetry(provider, filter);
    let newEventsCount = 0;

    const blockTimestamps = {};

    for (const log of logs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (!existingEventKeys.has(key)) {
            const formatted = formatLog(log);
            if (formatted) {
                if (!blockTimestamps[log.blockNumber]) {
                    const block = await provider.getBlock(log.blockNumber);
                    blockTimestamps[log.blockNumber] = block ? block.timestamp.toString() : Math.floor(Date.now() / 1000).toString();
                }
                formatted.timestamp = blockTimestamps[log.blockNumber];

                eventsDb.events.push(formatted);
                existingEventKeys.add(key);
                newEventsCount++;
            }
        }
    }

    state.lastProcessedBlock = Math.max(state.lastProcessedBlock, toBlock);
    state.processedRanges.push({ from: fromBlock, to: toBlock, timestamp: new Date().toISOString() });

    if (state.processedRanges.length > 500) {
        state.processedRanges = state.processedRanges.slice(-200);
    }

    saveState(state);
    if (newEventsCount > 0) {
        saveEvents(eventsDb);
        updateTradesDatabase(NETWORK);
    }

    return newEventsCount;
}

async function main() {
    console.log('='.repeat(70));
    console.log(`BrokexCore Event Indexer [${NETWORK.toUpperCase()}]`);
    console.log(`Network          : ${NETWORK}`);
    console.log(`RPC Endpoint     : ${RPC_URL}`);
    console.log(`Contract Address : ${CONTRACT_ADDRESS}`);
    console.log(`Deployment Block : ${DEPLOYMENT_BLOCK}`);
    console.log(`Data Directory   : ${DATA_DIR}`);
    console.log(`Monitored Events : ${Array.from(ALLOWED_EVENTS).join(', ')}`);
    console.log('='.repeat(70));

    const provider = new ethers.JsonRpcProvider(RPC_URL);

    const state = loadState();
    const eventsDb = loadEvents();

    const existingEventKeys = new Set(eventsDb.events.map(e => e.id || `${e.transactionHash}-${e.logIndex}`));

    console.log(`[INIT] State loaded. Last recorded block: ${state.lastProcessedBlock}. Total events: ${eventsDb.events.length}`);

    // 1. Catch-up Phase
    let currentBlock = await provider.getBlockNumber();
    console.log(`[CATCH-UP] Verifying blockchain history from DEPLOYMENT_BLOCK (${DEPLOYMENT_BLOCK}) to Head (${currentBlock})...`);

    let startBlock = DEPLOYMENT_BLOCK;

    if (startBlock <= currentBlock) {
        while (startBlock <= currentBlock) {
            const endBlock = Math.min(startBlock + BATCH_SIZE - 1, currentBlock);
            const progress = ((endBlock - DEPLOYMENT_BLOCK) / Math.max(1, (currentBlock - DEPLOYMENT_BLOCK)) * 100).toFixed(1);
            console.log(`[CATCH-UP] Verifying blocks ${startBlock} -> ${endBlock} (${progress}%)...`);
            
            const count = await processBlockRange(provider, startBlock, endBlock, state, eventsDb, existingEventKeys);
            if (count > 0) {
                console.log(`[CATCH-UP] +${count} new/missing event(s) indexed.`);
            }

            startBlock = endBlock + 1;
            await sleep(REQUEST_DELAY_MS);
        }
        console.log(`[CATCH-UP COMPLETE] Full history verified up to block ${currentBlock}. Total events in DB: ${eventsDb.events.length}`);
    }

    saveEvents(eventsDb);
    saveState(state);
    updateTradesDatabase(NETWORK);
    updateReferralsDatabase(NETWORK);
    updateVolumeDatabase(NETWORK);
    await updateProtocolInfo(provider, currentBlock, NETWORK);

    // 2. Real-time Polling Loop
    console.log(`\n[LIVE] Entering continuous polling mode (every ${POLL_INTERVAL_MS}ms)...`);
    
    let lastPolledBlock = currentBlock;

    while (true) {
        try {
            const latestBlock = await provider.getBlockNumber();
            
            if (latestBlock > lastPolledBlock) {
                const scanFrom = lastPolledBlock + 1;
                const scanTo = latestBlock;
                
                const count = await processBlockRange(provider, scanFrom, scanTo, state, eventsDb, existingEventKeys);
                if (count > 0) {
                    console.log(`[LIVE] Indexed +${count} new event(s) in blocks ${scanFrom} -> ${scanTo}.`);
                    updateReferralsDatabase(NETWORK);
                    updateVolumeDatabase(NETWORK);
                }

                await updateProtocolInfo(provider, latestBlock, NETWORK);
                lastPolledBlock = latestBlock;
            }
        } catch (pollErr) {
            console.error(`[LIVE ERROR] Polling failed: ${pollErr.message}`);
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`[FATAL ERROR] ${err.message}`);
        process.exit(1);
    });
}
