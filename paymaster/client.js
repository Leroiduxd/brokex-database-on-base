/**
 * ==============================================================================
 * COINBASE PAYMASTER & ERC-4337 BUNDLER CLIENT (`paymaster/client.js`)
 * ==============================================================================
 *
 * Generic, reusable client to interact with Coinbase Developer Platform (CDP)
 * Bundler & Paymaster (ERC-4337 v0.6 SimpleSmartAccount).
 *
 * Supports:
 * - Base Sepolia (Testnet) and Base (Mainnet)
 * - Gasless single transactions (e.g. openOrder, cancelOrder, execute, etc.)
 * - Gasless batched multi-calls (e.g. approve USDC + openOrder in a single transaction)
 * ==============================================================================
 */

const { createPublicClient, http, encodeFunctionData, parseAbi } = require('viem');
const { baseSepolia, base } = require('viem/chains');
const { privateKeyToAccount } = require('viem/accounts');
const { createSmartAccountClient } = require('permissionless');
const { toSimpleSmartAccount } = require('permissionless/accounts');
const { createPaymasterClient } = require('viem/account-abstraction');
const { getNetworkConfig } = require('../config');

const ENTRY_POINT_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

/**
 * Creates and initializes a Paymaster-enabled Smart Account Client.
 *
 * @param {Object} [options]
 * @param {string} [options.network] - 'testnet' | 'mainnet'
 * @param {string} [options.privateKey] - EOA Private Key
 * @param {string} [options.bundlerUrl] - CDP Bundler RPC URL
 * @returns {Promise<{smartAccountClient: any, smartAccount: any, publicClient: any, network: string, chain: any}>}
 */
async function getSmartAccountClient(options = {}) {
    const netConfig = getNetworkConfig(options.network);
    const bundlerUrl = options.bundlerUrl || netConfig.bundlerUrl;
    const privateKey = options.privateKey || netConfig.privateKey;
    const targetChain = netConfig.isMainnet ? base : baseSepolia;

    if (!bundlerUrl) {
        throw new Error(`[PAYMASTER ERROR] Missing Bundler URL for ${netConfig.network}. Check .env.`);
    }
    if (!privateKey) {
        throw new Error('[PAYMASTER ERROR] Missing PRIVATE_KEY in .env or options.');
    }

    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const owner = privateKeyToAccount(formattedPrivateKey);

    const publicClient = createPublicClient({
        chain: targetChain,
        transport: http(bundlerUrl)
    });

    const paymasterClient = createPaymasterClient({
        transport: http(bundlerUrl)
    });

    const smartAccount = await toSimpleSmartAccount({
        client: publicClient,
        owner,
        entryPoint: {
            address: ENTRY_POINT_V06,
            version: '0.6'
        }
    });

    const smartAccountClient = createSmartAccountClient({
        account: smartAccount,
        chain: targetChain,
        bundlerTransport: http(bundlerUrl),
        paymaster: paymasterClient
    });

    return {
        smartAccountClient,
        smartAccount,
        publicClient,
        network: netConfig.network,
        chain: targetChain
    };
}

/**
 * Sends a single 100% gasless transaction sponsored by Coinbase Paymaster.
 *
 * @param {Object} txParams
 * @param {`0x${string}`} txParams.to - Target smart contract address
 * @param {`0x${string}`} txParams.data - Encoded call data
 * @param {bigint} [txParams.value=0n] - Native ETH value (optional)
 * @param {Object} [clientOptions] - Client connection options (e.g. { network: 'mainnet' })
 * @returns {Promise<`0x${string}`>} Transaction hash
 */
async function sendGaslessTransaction(txParams, clientOptions = {}) {
    const { smartAccountClient, smartAccount, network } = await getSmartAccountClient(clientOptions);

    console.log(`[PAYMASTER] [${network.toUpperCase()}] Sender Smart Account : ${smartAccount.address}`);
    console.log(`[PAYMASTER] [${network.toUpperCase()}] Target Contract      : ${txParams.to}`);

    const txHash = await smartAccountClient.sendTransaction({
        to: txParams.to,
        data: txParams.data,
        value: txParams.value || 0n
    });

    console.log(`[PAYMASTER] ✅ Sponsored Transaction Broadcasted! Hash: ${txHash}`);
    return txHash;
}

/**
 * Sends batched (multi-call) gasless transactions sponsored by Coinbase Paymaster in a single UserOp.
 *
 * @param {Array<{to: `0x${string}`, data: `0x${string}`, value?: bigint}>} calls - Array of calls to execute atomically
 * @param {Object} [clientOptions] - Client connection options (e.g. { network: 'mainnet' })
 * @returns {Promise<`0x${string}`>} Transaction hash
 */
async function sendGaslessBatch(calls, clientOptions = {}) {
    const { smartAccountClient, smartAccount, network } = await getSmartAccountClient(clientOptions);

    console.log(`[PAYMASTER] [${network.toUpperCase()}] Sender Smart Account : ${smartAccount.address}`);
    console.log(`[PAYMASTER] [${network.toUpperCase()}] Dispatching Batch of ${calls.length} call(s)...`);

    const txHash = await smartAccountClient.sendTransactions({
        transactions: calls.map(c => ({
            to: c.to,
            data: c.data,
            value: c.value || 0n
        }))
    });

    console.log(`[PAYMASTER] ✅ Sponsored Batch Broadcasted! Hash: ${txHash}`);
    return txHash;
}

module.exports = {
    ENTRY_POINT_V06,
    getSmartAccountClient,
    sendGaslessTransaction,
    sendGaslessBatch
};
