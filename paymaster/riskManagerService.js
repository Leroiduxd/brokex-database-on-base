/**
 * ==============================================================================
 * RISK MANAGER SERVICE (`paymaster/riskManagerService.js`)
 * ==============================================================================
 *
 * Microservice client to fetch real-time cryptographically signed RiskLimits
 * payload required by `BrokexCore.execute(..., limits)`.
 * Supports both testnet and mainnet configurations.
 * ==============================================================================
 */

require('dotenv').config();

const DEFAULT_RISK_MANAGER_URL = process.env.RISK_MANAGER_URL || 'https://ab3rhxxjrvmtm6hrkh52njsc7e0xdluy.lambda-url.eu-north-1.on.aws/';

/**
 * Fetches the signed RiskLimits from the Risk Manager microservice.
 *
 * @param {string} [network] - Optional network target ('mainnet' | 'testnet'). Defaults to process.env.NETWORK or 'testnet'.
 * @param {string} [baseUrl] - Optional override base URL
 * @returns {Promise<{ maxOILong: bigint, maxOIShort: bigint, timestamp: bigint, r: `0x${string}`, s: `0x${string}`, v: number, network: string }>}
 */
async function getRiskLimits(network, baseUrl) {
    const targetNetwork = (network || process.env.NETWORK || 'testnet').toLowerCase().trim();
    const base = baseUrl || DEFAULT_RISK_MANAGER_URL;

    // Build URL with network query parameter
    const url = new URL(base);
    url.searchParams.set('network', targetNetwork);

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`[RISK MANAGER] HTTP ${response.status} (${response.statusText}): ${await response.text()}`);
    }

    const data = await response.json();
    if (!data.success || !data.riskLimits) {
        throw new Error(`[RISK MANAGER] Invalid payload: ${JSON.stringify(data)}`);
    }

    const { maxOILong, maxOIShort, timestamp, r, s, v } = data.riskLimits;

    return {
        network: data.network || targetNetwork,
        maxOILong: BigInt(maxOILong),
        maxOIShort: BigInt(maxOIShort),
        timestamp: BigInt(timestamp),
        r: r.startsWith('0x') ? r : `0x${r}`,
        s: s.startsWith('0x') ? s : `0x${s}`,
        v: Number(v)
    };
}

module.exports = {
    getRiskLimits,
    DEFAULT_RISK_MANAGER_URL
};
