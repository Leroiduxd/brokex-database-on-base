const fs = require('fs');
const path = require('path');
const { getNetworkConfig } = require('./config');

function reconstructReferrals(events = []) {
    const data = {
        updatedAt: new Date().toISOString(),
        totalAffiliateLinks: 0,
        traders: {}
    };

    let totalLinks = 0;

    function getOrCreateProfile(addr) {
        if (!addr) return null;
        const normalized = addr.toLowerCase();
        if (!data.traders[normalized]) {
            data.traders[normalized] = {
                address: addr,
                referrer: null,
                referralRate: null,
                boundAt: null,
                affiliates: [],
                pendingRewards: "0",
                claimedRewards: "0",
                totalEarned: "0",
                rewardsHistory: [],
                claimsHistory: []
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
        switch (ev.event) {
            case 'ReferrerSet': {
                const traderAddr = ev.args.trader;
                const referrerAddr = ev.args.referrer;
                const rate = ev.args.referralRate;
                const timestamp = parseInt(ev.timestamp);

                const traderProfile = getOrCreateProfile(traderAddr);
                const referrerProfile = getOrCreateProfile(referrerAddr);

                if (traderProfile && referrerProfile) {
                    traderProfile.referrer = referrerAddr;
                    traderProfile.referralRate = rate;
                    traderProfile.boundAt = timestamp;

                    const existingAffiliate = referrerProfile.affiliates.find(
                        a => a.address.toLowerCase() === traderAddr.toLowerCase()
                    );
                    if (!existingAffiliate) {
                        referrerProfile.affiliates.push({
                            address: traderAddr,
                            referralRate: rate,
                            boundAt: timestamp
                        });
                        totalLinks++;
                    }
                }
                break;
            }

            case 'ReferralRewardAccrued': {
                const referrerAddr = ev.args.referrer;
                const traderAddr = ev.args.trader;
                const tradeId = ev.args.tradeId;
                const amountStr = ev.args.amount || "0";
                const amountBig = BigInt(amountStr);
                const timestamp = parseInt(ev.timestamp);

                const referrerProfile = getOrCreateProfile(referrerAddr);
                if (referrerProfile) {
                    const currentPending = BigInt(referrerProfile.pendingRewards);
                    const currentTotal = BigInt(referrerProfile.totalEarned);

                    referrerProfile.pendingRewards = (currentPending + amountBig).toString();
                    referrerProfile.totalEarned = (currentTotal + amountBig).toString();

                    referrerProfile.rewardsHistory.push({
                        tradeId,
                        trader: traderAddr,
                        amount: amountStr,
                        timestamp,
                        txHash: ev.transactionHash,
                        blockNumber: ev.blockNumber
                    });
                }
                break;
            }

            case 'ReferralRewardsClaimed': {
                const referrerAddr = ev.args.referrer;
                const amountStr = ev.args.amount || "0";
                const amountBig = BigInt(amountStr);
                const timestamp = parseInt(ev.timestamp);

                const referrerProfile = getOrCreateProfile(referrerAddr);
                if (referrerProfile) {
                    const currentPending = BigInt(referrerProfile.pendingRewards);
                    const currentClaimed = BigInt(referrerProfile.claimedRewards);

                    const newPending = currentPending >= amountBig ? currentPending - amountBig : 0n;
                    referrerProfile.pendingRewards = newPending.toString();
                    referrerProfile.claimedRewards = (currentClaimed + amountBig).toString();

                    referrerProfile.claimsHistory.push({
                        amount: amountStr,
                        timestamp,
                        txHash: ev.transactionHash,
                        blockNumber: ev.blockNumber
                    });
                }
                break;
            }
        }
    }

    data.totalAffiliateLinks = totalLinks;
    return data;
}

function updateReferralsDatabase(network) {
    const config = getNetworkConfig(network);

    if (!fs.existsSync(config.dataDir)) {
        fs.mkdirSync(config.dataDir, { recursive: true });
    }

    if (!fs.existsSync(config.eventsFile)) {
        return { updatedAt: new Date().toISOString(), totalAffiliateLinks: 0, traders: {} };
    }

    try {
        const eventsData = JSON.parse(fs.readFileSync(config.eventsFile, 'utf8'));
        const referralDb = reconstructReferrals(eventsData.events || []);

        fs.writeFileSync(config.referralsFile, JSON.stringify(referralDb, null, 2), 'utf8');
        return referralDb;
    } catch (err) {
        console.error(`[ERROR] Failed to update referrals database (${config.network}): ${err.message}`);
        return { updatedAt: new Date().toISOString(), totalAffiliateLinks: 0, traders: {} };
    }
}

function getReferralInfo(traderAddress, network) {
    const referralDb = updateReferralsDatabase(network);
    if (!traderAddress) return null;
    const normalized = traderAddress.toLowerCase();
    return referralDb.traders[normalized] || null;
}

module.exports = {
    reconstructReferrals,
    updateReferralsDatabase,
    getReferralInfo
};
