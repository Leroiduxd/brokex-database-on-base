# Brokex Database & Indexer Engine — Documentation

This documentation provides an overview of the purpose and capabilities of each script in the engine.

---

## 1. Core Services

### `indexer.js`
- **Purpose**: Continuous event listener and blockchain state synchronizer.
- **Capabilities**:
  - Connects to Base Sepolia via JSON-RPC.
  - Automatically synchronizes all historical events since the contract deployment block (`45490794`) in controlled batches.
  - Switches to live monitoring mode, scanning each newly minted block in real time.
  - Decodes and persists the 5 core Brokex events without duplicates.
  - Automatically triggers trade state recalculations whenever new events are indexed.

### `tradeService.js`
- **Purpose**: Trade lifecycle and event aggregation engine.
- **Capabilities**:
  - Reconstructs complete trade objects from raw event logs.
  - Tracks state transitions: `CREATED` -> `OPEN` -> `CLOSED` or `CANCELLED`.
  - Maintains full financial records (entry/exit prices, spreads, margin, open interest, borrow fees, PnL, trader payout).
  - Preserves entire stop-loss and take-profit modification history (`stopsHistory`).
  - Maintains a full timeline of events and associated transaction hashes.
  - Exports helper functions for querying and updating `data/trades.json`.

---

## 2. Query & Evaluation Utilities

### `getTrade.js`
- **Purpose**: Single trade lookup utility.
- **Capabilities**:
  - Takes a `tradeId` as input and returns a complete, chronological breakdown of the trade.
  - Displays all trade parameters, opening/closing executions, risk management changes, and transaction hashes.
  - If executed with no arguments, lists a high-level summary of all known trades.
- **CLI Usage**:
  ```bash
  node getTrade.js 5
  ```

### `getTraderTrades.js`
- **Purpose**: Trader portfolio and history query utility.
- **Capabilities**:
  - Takes an Ethereum wallet address as input.
  - Returns all trades created, opened, closed, or cancelled by that trader.
  - Displays individual trade status, direction, leverage, collateral, execution prices, and net PnL.
- **CLI Usage**:
  ```bash
  node getTraderTrades.js 0xEaeAe8E46992e7D3832f964B320D41874476508b
  ```

### `getExecutableOrders.js`
- **Purpose**: Pending limit and stop order evaluation engine (Order matching / Trigger checker).
- **Capabilities**:
  - Takes a current market / oracle price as input.
  - Filters all pending orders (status `CREATED`) and identifies which orders must be triggered and opened:
    - **LIMIT LONG**: Market price <= Target price
    - **LIMIT SHORT**: Market price >= Target price
    - **STOP LONG**: Market price >= Target price
    - **STOP SHORT**: Market price <= Target price
  - Outputs the list of triggerable orders along with the trigger rationale.
- **CLI Usage**:
  ```bash
  node getExecutableOrders.js 63000000000
  ```

- `server.js` : Serveur d'API publique REST & SSE avec documentation HTML interactive sur `/`.
- `executionEngine.js` : Bot d'exécution autonome en direct (écoute Pyth SSE en continu, évalue tous les ordres/stops/liquidations, et appelle la Lambda Executor).
- `callExecutor.js` : Client d'exécution automatisée communiquant avec la Lambda AWS (Pyth + Risk Manager + KMS).
- `getLiquidationPrices.js` : Calcule les prix de liquidation exacts et les borrow fees accumulés pour chaque trade ouvert.
- `getAverageOpenPrices.js` : Calcule les prix moyens pondérés par l'Open Interest pour les positions ouvertes LONG et SHORT.
- `getExecutableOrders.js` : Identifie les ordres limites et stop en attente de déclenchement.
- `getExecutableStops.js` : Identifie les Take-Profit, Stop-Loss et Liquidations déclenchables.

---

## 3. Guide des Commandes

```bash
# 🚀 1. Lancer TOUT en 1 seule commande (Indexer + API Server + Bot d'Exécution)
npm run dev
# ou : npm start

# 🖥️ 2. Gestion en Production sur VPS avec PM2
pm2 start ecosystem.config.js
# ou via les raccourcis npm :
npm run pm2:start
pm2 list
pm2 logs
pm2 stop all

# 🔧 3. Lancer un service individuellement
npm run api        # Serveur API REST & SSE (http://localhost:3000)
npm run indexer    # Indexeur Blockchain & Lens
npm run bot        # Bot d'Exécution automatique Pyth

# 📊 4. Scripts d'analyse & calculs
npm run liq        # Prix de liquidation de tous les trades ouverts
npm run avg        # Prix moyens d'ouverture pondérés par l'Open Interest
npm run referral -- 0xC81db5107BB6e6782BBc3941938D72884CC2BFEf # Parrainage & commissions
npm run volume -- 0xC81db5107BB6e6782BBc3941938D72884CC2BFEf   # Volume cumulé & historique
```

---

## 4. Endpoints de l'API Publique (`server.js`)

| Endpoint | Méthode / Type | Description |
| :--- | :--- | :--- |
| **`/`** ou **`/docs`** | `GET (HTML)` | Page de documentation épurée et moderne |
| **`/stream`** | `GET (SSE)` | Flux streaming de prix en direct (Server-Sent Events) |
| **`/oracle`** | `GET (JSON)` | Prix spot réel Pyth Network avec **cache mémoire 1 seconde anti-DDoS** |
| **`/proof`** | `GET (JSON)` | Preuve binaire cryptographique Pyth Hermes v2 (`priceUpdateData` EVM) |
| **`/protocol-info`** | `GET (JSON)` | Métriques complètes du protocole (`BrokexLens` + horaires marché Pyth) |
| **`/trader/:address`** | `GET (JSON)` | Liste complète des trades et de l'historique d'un trader |
| **`/referrals/:address`**| `GET (JSON)` | Profil de parrainage (parrain, filleuls, gains USDC, historique claims) |
| **`/volume/:address`**   | `GET (JSON)` | Volume cumulé et historique des événements `CumulativeVolumeIncreased` |
| **`/trades`**            | `GET (JSON)` | Historique des trades récents paginé (`?limit=50&offset=0&status=OPEN`) |
| **`/open-trades`** ou **`/trades/open`** | `GET (JSON)` | **Positions ouvertes actives uniquement** (direction, prix d'entrée, levier, liquidation, marge, OI, SL/TP) |
| **`/liquidations`**      | `GET (JSON)` | Prix de liquidation et frais d'emprunt calculés pour tous les trades ouverts |
| **`/average-prices`**    | `GET (JSON)` | Prix moyens d'ouverture pondérés par l'Open Interest |
| **`/chart/history`**     | `GET (JSON)` | Historique des chandeliers TradingView (`?from=...&to=...&resolution=1`) |
| **`/chart/sparkline`**   | `GET (JSON)` | Variations 1h, 24h, 7d, 30d et sparkline 120 points |

```bash
# 5. Inspecter un trade
node getTrade.js 1

# 6. Lister les trades d'un trader
node getTraderTrades.js 0xEaeAe8E46992e7D3832f964B320D41874476508b

# 7. Consulter l'affiliation et commissions d'un trader
node getReferral.js 0xC81db5107BB6e6782BBc3941938D72884CC2BFEf

# 8. Consulter le volume cumulé d'un trader
node getTraderVolume.js 0xC81db5107BB6e6782BBc3941938D72884CC2BFEf

# 9. Récupérer la preuve cryptographique Pyth d'un actif
npm run proof

# 10. Écouter le streaming en temps réel
npm run stream
```

---

## 4. Documentation Détaillée : `callExecutor.js`

### 🎯 Rôle
Client HTTP permettant d'invoquer le microservice Serverless (AWS Lambda) qui orchestre l'évaluation des conditions de déclenchement et l'envoi de transactions `execute()` sécurisées par AWS KMS sur `BrokexCore`.

### 🔄 Pipeline d'Exécution de la Lambda :
1. **Vérification des heures de marché** (`market_hours` Pyth).
2. **Récupération de l'état on-chain** (`BrokexLens`).
3. **Évaluation du prix spot Pyth** contre les conditions (`Limit`, `Stop`, `TP`, `SL`, `Liquidation`).
4. **Récupération des preuves** (`Hermes v2` + `Risk Manager`).
5. **Signature et diffusion on-chain** sécurisée par `AWS KMS`.

### 💻 Paramètres d'appel JS :
```javascript
const { executeTradesApi } = require('./callExecutor');

const res = await executeTradesApi({
  tradeIds: [8, 10], // IDs à exécuter
  feedId: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2', // Optionnel (prend .env)
  dryRun: false // true pour simuler sans payer de gas
});
```

---

## 5. Stockage des Données (`data/`)

- **`data/events.json`** : Journal complet des événements indexés avec clés uniques (`transactionHash-logIndex`).
- **`data/state.json`** : État d'avancement de l'indexeur (`lastProcessedBlock`, plages scannées).
- **`data/trades.json`** : Base de données reconstruite de tous les trades indexés par `tradeId`.
- **`data/protocolInfo.json`** : Dernier snapshot global du protocole (`BrokexLens` + métadonnées de marché Pyth).
- **`data/sparkline.json`** : Variations temporelles (`1h`, `24h`, `7d`, `30d`) et sparkline des prix récents.
