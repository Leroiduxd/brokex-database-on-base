const { getReferralInfo } = require('./referralService');
const { getNetworkConfig } = require('./config');

const netConfig = getNetworkConfig();
const traderInput = process.argv[2];

if (!traderInput) {
    console.log(`Usage: node getReferral.js <traderAddress> [testnet|mainnet]`);
    console.log('Example: node getReferral.js 0x93316F926b42b26b38c20537482D2b19280E1d53');
    process.exit(0);
}

const profile = getReferralInfo(traderInput, netConfig.network);

console.log('='.repeat(70));
console.log(`REFERRAL PROFILE: ${traderInput} [${netConfig.network.toUpperCase()}]`);
console.log('='.repeat(70));

if (!profile) {
    console.log('No referral activity found for this address on this network.');
    process.exit(0);
}

console.log(`Referrer Address : ${profile.referrer || 'None'}`);
console.log(`Affiliates Count : ${profile.affiliates.length}`);
console.log(`Pending Rewards  : ${(Number(profile.pendingRewards) / 1e6).toFixed(2)} USDC`);
console.log(`Claimed Rewards  : ${(Number(profile.claimedRewards) / 1e6).toFixed(2)} USDC`);
console.log(`Total Earned     : ${(Number(profile.totalEarned) / 1e6).toFixed(2)} USDC`);

if (profile.affiliates.length > 0) {
    console.log('\nAffiliates List:');
    profile.affiliates.forEach((aff, i) => {
        console.log(`  ${i + 1}. ${aff.address} (Rate: ${(Number(aff.referralRate) / 100).toFixed(2)}%)`);
    });
}
console.log('='.repeat(70));
