/**
 * ==============================================================================
 * COINBASE PAYMASTER CLI / TEST RUNNER (`paymaster/testPaymaster.js`)
 * ==============================================================================
 *
 * Test script to verify your Coinbase Paymaster connection & print your
 * User Smart Account (ERC-4337) address.
 *
 * USAGE:
 *   node paymaster/testPaymaster.js
 * ==============================================================================
 */

require('dotenv').config();
const { getSmartAccountClient } = require('./client');

async function testConnection() {
    console.log('='.repeat(70));
    console.log('COINBASE PAYMASTER & ERC-4337 CONNECTION TEST');
    console.log('='.repeat(70));

    try {
        console.log('Initializing Smart Account Client...');
        const { smartAccount, publicClient } = await getSmartAccountClient();

        console.log('\n[SUCCESS] Connected to Coinbase Bundler & Paymaster!');
        console.log(`Smart Account Address (ERC-4337): ${smartAccount.address}`);

        const blockNumber = await publicClient.getBlockNumber();
        console.log(`Current Base Sepolia Block      : ${blockNumber}`);
        console.log('='.repeat(70));
    } catch (error) {
        console.error('\n[ERROR] Failed testing Paymaster connection:');
        console.error(error.message);
        console.log('\n👉 Make sure your .env contains:');
        console.log('   COINBASE_BUNDLER_URL=https://api.developer.coinbase.com/rpc/v1/base-sepolia/<CDP_API_KEY>');
        console.log('   PRIVATE_KEY=0x<VOTRE_CLE_PRIVEE>');
    }
}

if (require.main === module) {
    testConnection();
}

module.exports = { testConnection };
