const { spawn } = require('child_process');
const path = require('path');
const { resolveNetwork } = require('./config');

// Target network: Default to 'testnet' unless explicitly passed as CLI argument (e.g. node startAll.js all | mainnet)
const requestedNetwork = process.argv[2] || process.env.NETWORK || 'testnet';

console.log('================================================================================');
console.log(`⚡ STARTING BROKEX MULTI-SERVICE SUITE [${requestedNetwork.toUpperCase()}]`);
console.log('================================================================================');

let services = [];

if (requestedNetwork === 'all') {
  // Concurrent mode: Start indexers & bots for both Testnet & Mainnet, plus 1 Shared API Server
  services = [
    { name: 'INDEXER-TESTNET', script: 'indexer.js', network: 'testnet', color: '\x1b[36m' }, // Cyan
    { name: 'INDEXER-MAINNET', script: 'indexer.js', network: 'mainnet', color: '\x1b[34m' }, // Blue
    { name: 'API SERVER    ', script: 'server.js',  network: 'testnet', color: '\x1b[32m' }, // Green (Serves both testnet & mainnet)
    { name: 'EXEC-TESTNET  ', script: 'executionEngine.js', network: 'testnet', color: '\x1b[35m' }, // Magenta
    { name: 'EXEC-MAINNET  ', script: 'executionEngine.js', network: 'mainnet', color: '\x1b[33m' }  // Yellow
  ];
} else {
  // Single network mode
  const net = resolveNetwork(requestedNetwork);
  services = [
    { name: `INDEXER-${net.toUpperCase()}`, script: 'indexer.js', network: net, color: '\x1b[36m' },
    { name: `API SERVER-${net.toUpperCase()}`, script: 'server.js', network: net, color: '\x1b[32m' },
    { name: `EXEC-${net.toUpperCase()}`, script: 'executionEngine.js', network: net, color: '\x1b[35m' }
  ];
}

const children = [];

function startService(service) {
  const scriptPath = path.join(__dirname, service.script);
  const child = spawn(process.execPath, [scriptPath, service.network], {
    cwd: __dirname,
    env: { ...process.env, NETWORK: service.network },
    stdio: ['inherit', 'pipe', 'pipe']
  });

  const prefix = `${service.color}[${service.name}]\x1b[0m `;

  child.stdout.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      console.log(`${prefix}${line}`);
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      console.error(`${prefix}\x1b[31m${line}\x1b[0m`);
    }
  });

  child.on('exit', (code, signal) => {
    console.log(`${prefix}exited with code ${code || signal}`);
  });

  children.push(child);
}

// Start all services
for (const s of services) {
  startService(s);
}

// Graceful shutdown handling
function shutdown() {
  console.log('\n[RUNNER] Shutting down all services...');
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
