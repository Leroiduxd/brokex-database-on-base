const config = require('./config');
const storageService = require('./storageService');

class PythService {
  constructor() {
    this.baseUrl = `${config.baseUrl}/v1/shims/tradingview/history`;
    this.lastRequestTime = 0;
    this.currentRetryDelay = config.api.retry429DelayMs;
  }

  /**
   * Limiteur de debit strict : assure un delai minimum entre chaque requete
   */
  async throttle() {
    const now = Date.now();
    const minDelay = (config.api.windowSeconds / config.api.maxRequests) * 1000;
    const timeSinceLast = now - this.lastRequestTime;

    if (timeSinceLast < minDelay) {
      const waitTime = minDelay - timeSinceLast;
      await new Promise(res => setTimeout(res, waitTime));
      return this.throttle();
    }

    this.lastRequestTime = Date.now();
  }

  async get1mHistory(symbol, from, to) {
    await this.throttle();

    const url = `${this.baseUrl}?symbol=${encodeURIComponent(symbol)}&resolution=1&from=${from}&to=${to}`;

    try {
      const response = await fetch(url);

      if (response.status === 429) {
        console.warn(`[PythService] 429 rate limit detected. Waiting ${this.currentRetryDelay / 1000}s...`);
        await new Promise(res => setTimeout(res, this.currentRetryDelay));
        this.currentRetryDelay *= 2;
        return this.get1mHistory(symbol, from, to);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data && data.s === "ok" && data.t && data.t.length > 0) {
        this.currentRetryDelay = config.api.retry429DelayMs;
        return data.t.map((t, i) => ({
          time: Number(t),
          open: Number(data.o[i]),
          high: Number(data.h[i]),
          low: Number(data.l[i]),
          close: Number(data.c[i]),
          volume: data.v ? Number(data.v[i]) : 0
        }));
      }

      return [];
    } catch (error) {
      console.error(`[PythService] Error Pyth API (${symbol}): ${error.message}`);
      return [];
    }
  }

  async fetchMissing1m(symbol, from, to) {
    let currentFrom = from;
    const step = 5000 * 60; // 5000 minutes per chunk
    const allNewData = [];

    while (currentFrom < to) {
      const currentTo = Math.min(currentFrom + step, to);
      const progress = (((currentFrom - from) / Math.max(1, to - from)) * 100).toFixed(1);
      
      console.log(`[PythService] Sync ${symbol} 1m: ${progress}% complete...`);
      
      const chunk = await this.get1mHistory(symbol, currentFrom, currentTo);
      
      if (chunk && chunk.length > 0) {
        allNewData.push(...chunk);
        const existing = await storageService.load(symbol, "1");
        const merged = this.mergeCandles(existing, chunk);
        await storageService.save(symbol, "1", merged);
        
        currentFrom = chunk[chunk.length - 1].time + 1;
      } else {
        currentFrom += step;
      }
    }

    return allNewData;
  }

  mergeCandles(existing, newData) {
    const map = new Map();
    (existing || []).forEach(c => map.set(c.time, c));
    (newData || []).forEach(c => map.set(c.time, c));
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }
}

module.exports = new PythService();
