module.exports = {
  apps: [
    // --- TESTNET SERVICES ---
    {
      name: 'brokex-indexer-testnet',
      script: './indexer.js',
      args: 'testnet',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        NETWORK: 'testnet'
      }
    },
    {
      name: 'brokex-bot-testnet',
      script: './executionEngine.js',
      args: 'testnet',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        NETWORK: 'testnet'
      }
    },

    // --- MAINNET SERVICES ---
    {
      name: 'brokex-indexer-mainnet',
      script: './indexer.js',
      args: 'mainnet',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        NETWORK: 'mainnet'
      }
    },
    {
      name: 'brokex-bot-mainnet',
      script: './executionEngine.js',
      args: 'mainnet',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        NETWORK: 'mainnet'
      }
    },

    // --- SHARED API SERVER (Serves both testnet & mainnet queries) ---
    {
      name: 'brokex-api',
      script: './server.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
