/**
 * Pyth Hermes Proof & Price Fetcher
 *
 * Retrieves cryptographic binary update proofs and parsed price data from Pyth Network Hermes v2 API:
 * GET https://hermes.pyth.network/v2/updates/price/latest?ids[]=<FEED_ID>
 *
 * Automatically reads PYTH_FEED_ID and PYTH_HERMES_URL from .env or accepts CLI arguments.
 */

require('dotenv').config();

const DEFAULT_HERMES_URL = 'https://hermes.pyth.network';
const HERMES_BASE_URL = process.env.PYTH_HERMES_URL || DEFAULT_HERMES_URL;

// In-memory 1-second cache to prevent spamming Hermes and avoid rate limiting
const proofMemoryCache = new Map(); // cacheKey -> { data, timestamp }
const CACHE_TTL_MS = 1000;

/**
 * Normalizes a feed ID to remove the 0x prefix if present.
 */
function normalizeFeedId(feedId) {
    if (!feedId) return '';
    return feedId.trim().replace(/^0x/i, '');
}

/**
 * Fetches price update data (binary proofs) from Hermes v2.
 * Includes a 1-second in-memory cache to protect downstream endpoints.
 *
 * @param {Object} options
 * @param {string|string[]} [options.feedIds] - Single feed ID or array of feed IDs
 * @param {string} [options.baseUrl] - Hermes base URL (default: https://hermes.pyth.network)
 * @param {'hex'|'base64'} [options.encoding='hex'] - Binary encoding
 * @param {boolean} [options.bypassCache=false] - Force fresh fetch
 * @returns {Promise<{ priceUpdateData: string[], parsedPrices: Array, raw: Object, cached: boolean }>}
 */
async function getPythProof(options = {}) {
    const rawFeedIds = options.feedIds || process.env.PYTH_FEED_ID;
    const baseUrl = options.baseUrl || HERMES_BASE_URL;
    const encoding = options.encoding || 'hex';
    const bypassCache = options.bypassCache ?? false;

    if (!rawFeedIds) {
        throw new Error('No Pyth Feed ID provided. Set PYTH_FEED_ID in .env or pass feedIds as argument.');
    }

    const feedList = Array.isArray(rawFeedIds) ? rawFeedIds : [rawFeedIds];
    const cleanIds = feedList.map(normalizeFeedId).filter(Boolean);

    if (cleanIds.length === 0) {
        throw new Error('Feed ID list is empty.');
    }

    const cacheKey = `${cleanIds.sort().join(',')}:${encoding}:${baseUrl}`;
    const now = Date.now();

    if (!bypassCache && proofMemoryCache.has(cacheKey)) {
        const cachedEntry = proofMemoryCache.get(cacheKey);
        if (now - cachedEntry.timestamp < CACHE_TTL_MS) {
            return {
                ...cachedEntry.data,
                cached: true,
                cachedAgeMs: now - cachedEntry.timestamp
            };
        }
    }

    const params = new URLSearchParams();
    cleanIds.forEach(id => params.append('ids[]', id));
    params.append('encoding', encoding);

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v2/updates/price/latest?${params.toString()}`;

    const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Hermes API error ${response.status} (${response.statusText}): ${await response.text()}`);
    }

    const json = await response.json();

    if (!json.binary || !Array.isArray(json.binary.data)) {
        throw new Error(`Invalid response structure from Hermes: ${JSON.stringify(json)}`);
    }

    // Format binary proof data with 0x prefix ready for EVM bytes[] parameter
    const priceUpdateData = json.binary.data.map(dataHex => {
        return dataHex.startsWith('0x') ? dataHex : `0x${dataHex}`;
    });

    // Parse human-readable prices
    const parsedPrices = (json.parsed || []).map(item => {
        const rawPriceBig = BigInt(item.price.price);
        const expo = Number(item.price.expo);
        const confBig = BigInt(item.price.conf);
        const publishTime = Number(item.price.publish_time);

        const realPrice = Number(rawPriceBig) * Math.pow(10, expo);
        const realConf = Number(confBig) * Math.pow(10, expo);

        return {
            feedId: `0x${item.id}`,
            cleanId: item.id,
            price: realPrice,
            confidence: realConf,
            rawPrice: item.price.price,
            rawConfidence: item.price.conf,
            expo,
            publishTime,
            publishDate: new Date(publishTime * 1000)
        };
    });

    const primary = parsedPrices[0] || null;

    const result = {
        priceUpdateData, // 👈 Array of '0x...' hex strings ready for smart contract
        parsedPrices,
        primaryPrice: primary ? primary.price : null,
        primaryFeedId: primary ? primary.feedId : null,
        primaryPublishTime: primary ? primary.publishDate : null,
        endpoint,
        raw: json,
        cached: false
    };

    // Store in 1-second memory cache
    proofMemoryCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
    });

    return result;
}

// CLI Execution
if (require.main === module) {
    const cliFeedId = process.argv[2] || process.env.PYTH_FEED_ID;

    console.log('='.repeat(80));
    console.log('PYTH HERMES V2 PROOF & PRICE FETCHER');
    console.log(`Feed ID Config  : ${cliFeedId || '(Not set in .env)'}`);
    console.log(`Hermes Endpoint : ${HERMES_BASE_URL}`);
    console.log('='.repeat(80));

    getPythProof({ feedIds: cliFeedId })
        .then(result => {
            console.log(`\n[STATUS: SUCCESS] Successfully fetched ${result.priceUpdateData.length} proof payload(s) from Hermes.`);
            console.log(`Endpoint URL: ${result.endpoint}\n`);

            console.log('[PARSED PRICES]');
            result.parsedPrices.forEach((p, idx) => {
                console.log(`  #${idx + 1} Feed ID    : ${p.feedId}`);
                console.log(`     Price      : $${p.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} (±$${p.confidence.toFixed(4)})`);
                console.log(`     Raw Price  : ${p.rawPrice} (expo: ${p.expo})`);
                console.log(`     Published  : ${p.publishDate.toISOString()} (unix: ${p.publishTime})`);
            });

            console.log('\n[EVM PRICE UPDATE DATA (BYTES[])]');
            console.log(JSON.stringify(result.priceUpdateData, null, 2));

            console.log('\n' + '='.repeat(80));
        })
        .catch(err => {
            console.error(`\n[ERROR] ${err.message}`);
            process.exit(1);
        });
}

module.exports = {
    getPythProof,
    normalizeFeedId
};
