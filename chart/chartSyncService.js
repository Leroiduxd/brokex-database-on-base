const config = require('./config');
const storageService = require('./storageService');
const pythService = require('./pythService');
const timeframeBuilder = require('./timeframeBuilder');
const { buildSparklineData, saveSparklineData } = require('./sparklineService');

class ChartSyncService {
  constructor() {
    this.data = {}; // { "Symbol": [m1 candles] }
  }

  async start() {
    const startPoint = Math.floor(new Date(config.historyStartDate).getTime() / 1000);
    console.log(`[ChartSync] Starting ChartSyncService (Source 1m, History start: ${config.historyStartDate})...`);
    
    for (const symbol of config.symbols) {
      // 1. Load existing 1m candles
      let m1Candles = await storageService.load(symbol, "1");
      
      const now = Math.floor(Date.now() / 1000);

      // 2. Determine fetch resume point
      let from = startPoint;
      if (m1Candles.length > 0) {
        const lastTime = m1Candles[m1Candles.length - 1].time;
        from = Math.max(startPoint, lastTime + 1);
      }

      // 3. Fetch missing data
      if (from < now - 60) {
        console.log(`[ChartSync] Syncing missing 1m candles for ${symbol}...`);
        const missing = await pythService.fetchMissing1m(symbol, from, now);
        if (missing && missing.length > 0) {
          // Deduplicate and merge
          const candleMap = new Map();
          for (const c of [...m1Candles, ...missing]) {
            candleMap.set(c.time, c);
          }
          m1Candles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
        }
      }

      this.data[symbol] = m1Candles;
      
      // 4. Generate all timeframes and save
      await this.rebuildAndSaveAll(symbol);
    }

    this.startUpdateLoop();
    console.log("[ChartSync] Chart system synchronized and ready.");
  }

  async rebuildAndSaveAll(symbol) {
    const m1 = this.data[symbol];
    if (!m1 || m1.length === 0) return;

    // Save complete 1m source
    await storageService.save(symbol, "1", m1);

    // Generate each configured timeframe
    for (const tf of config.generatedTimeframes) {
      const generated = timeframeBuilder.build(m1, tf);
      await storageService.save(symbol, tf, generated);
    }

    // Generate and save sparkline & diffs snapshot
    const sparklineData = buildSparklineData(symbol, m1);
    saveSparklineData(symbol, sparklineData);
  }

  startUpdateLoop() {
    setInterval(async () => {
      const now = new Date();
      if (now.getSeconds() === 1) {
        await this.performUpdate();
      }
    }, 1000);
  }

  async performUpdate() {
    const nowTs = Math.floor(Date.now() / 1000);
    
    for (const symbol of config.symbols) {
      const m1 = this.data[symbol] || [];
      const from = m1.length > 0 ? m1[m1.length - 1].time + 1 : nowTs - 120;

      const newData = await pythService.get1mHistory(symbol, from, nowTs);
      
      if (newData && newData.length > 0) {
        const candleMap = new Map();
        for (const c of [...m1, ...newData]) {
          candleMap.set(c.time, c);
        }
        this.data[symbol] = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
        await this.rebuildAndSaveAll(symbol);
        console.log(`[ChartSync] Live update for ${symbol}: +${newData.length} min candle(s).`);
      }
    }
  }

  /**
   * Returns candles for a symbol and resolution.
   * @param {string} symbol 
   * @param {string|number} resolution - e.g. "1", "5", "15", "60", "1d"
   * @returns {Promise<Array>}
   */
  async getCandles(symbol, resolution = "15") {
    const targetSymbol = symbol || config.symbols[0];
    const tfStr = resolution.toString();
    return await storageService.load(targetSymbol, tfStr);
  }
}

module.exports = new ChartSyncService();
