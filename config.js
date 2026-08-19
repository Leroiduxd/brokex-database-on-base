/**
 * ==============================================================================
 * NETWORK & GLOBAL CONFIGURATION HELPER (`config.js`)
 * ==============================================================================
 *
 * Centralizes network resolution (Testnet / Mainnet) across all microservices.
 * Supports:
 *   - CLI flag: `--network mainnet` or `--network testnet`
 *   - CLI positional: `node script.js mainnet` / `node script.js testnet`
 *   - Environment variable: `NETWORK=mainnet` / `NETWORK=testnet`
 *   - Default fallback: `testnet`
 * ==============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

/**
 * Resolves the active network name from CLI arguments or environment variables.
 * @param {string} [networkOverride] - Explicit network override ('mainnet' | 'testnet')
 * @returns {'testnet' | 'mainnet'}
 */
function resolveNetwork(networkOverride) {
    if (networkOverride) {
        const norm = networkOverride.toLowerCase().trim();
        if (norm === 'mainnet' || norm === 'testnet') return norm;
    }

    // 1. Check CLI arguments (e.g., --network mainnet or node script.js mainnet)
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i].toLowerCase();
        if (arg === '--network' || arg === '-n') {
            const val = (args[i + 1] || '').toLowerCase().trim();
            if (val === 'mainnet' || val === 'testnet') return val;
        }
        if (arg === 'mainnet' || arg === 'testnet') {
            return arg;
        }
    }

    // 2. Check process.env.NETWORK
    if (process.env.NETWORK) {
        const norm = process.env.NETWORK.toLowerCase().trim();
        if (norm === 'mainnet' || norm === 'testnet') return norm;
    }

    // 3. Fallback default
    return 'testnet';
}

/**
 * Retrieves configuration for the target network.
 * @param {string} [targetNetwork] - Optional network override
 */
function getNetworkConfig(targetNetwork) {
    const network = resolveNetwork(targetNetwork);
    const prefix = network === 'mainnet' ? 'MAINNET_' : 'TESTNET_';

    const rpcUrl = process.env[`${prefix}RPC_URL`] || process.env.RPC_URL;
    const coreAddress = process.env[`${prefix}BROKEX_CORE_ADDRESS`] || process.env.BROKEX_CORE_ADDRESS;
    const lensAddress = process.env[`${prefix}BROKEX_LENS_ADDRESS`] || process.env.BROKEX_LENS_ADDRESS;
    const bundlerUrl = process.env[`${prefix}COINBASE_BUNDLER_URL`] || process.env.COINBASE_BUNDLER_URL;
    
    const deploymentBlockStr = process.env[`${prefix}DEPLOYMENT_BLOCK`] || process.env.DEPLOYMENT_BLOCK || '0';
    const deploymentBlock = parseInt(deploymentBlockStr, 10);

    const baseDataDir = path.resolve(__dirname, 'data');
    const dataDir = path.join(baseDataDir, network);

    return {
        network,
        isMainnet: network === 'mainnet',
        isTestnet: network === 'testnet',
        
        // Blockchain & RPC
        rpcUrl,
        coreAddress,
        lensAddress,
        deploymentBlock,
        bundlerUrl,
        privateKey: process.env.PRIVATE_KEY,

        // Common Services
        riskManagerUrl: process.env.RISK_MANAGER_URL || 'https://ab3rhxxjrvmtm6hrkh52njsc7e0xdluy.lambda-url.eu-north-1.on.aws/',
        
        // Pyth Market Feed (Shared for both testnet and mainnet)
        pythSymbol: process.env.PYTH_SYMBOL || 'Metal.XAU/USD',
        pythFeedId: process.env.PYTH_FEED_ID || '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
        pythBenchmarksUrl: process.env.PYTH_BENCHMARKS_URL || 'https://benchmarks.pyth.network',
        pythHermesUrl: process.env.PYTH_HERMES_URL || 'https://hermes.pyth.network',
        pythStreamingUrl: process.env.PYTH_STREAMING_URL || 'https://benchmarks.pyth.network/v1/shims/tradingview/streaming',

        // Scanner Tunings
        batchSize: parseInt(process.env.BATCH_SIZE || '2000', 10),
        requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '200', 10),
        pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),

        // Storage Paths
        dataDir,
        stateFile: path.join(dataDir, 'state.json'),
        eventsFile: path.join(dataDir, 'events.json'),
        tradesFile: path.join(dataDir, 'trades.json'),
        protocolInfoFile: path.join(dataDir, 'protocolInfo.json'),
        referralsFile: path.join(dataDir, 'referrals.json'),
        volumeFile: path.join(dataDir, 'cumulativeVolume.json'),
        sparklineFile: path.join(baseDataDir, 'sparkline.json'), // Shared
        chartDir: path.join(baseDataDir, 'chart')                 // Shared
    };
}

module.exports = {
    resolveNetwork,
    getNetworkConfig
};
