#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up Cross-Chain Trailing-Range Rebalancer for local development...\n');

// Check if .env file exists
const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.log('⚠️  .env file not found. Creating a basic .env file for local development...');
  
  const basicEnv = `# Basic configuration for local development
# You can add real RPC URLs and API keys for testnet deployment

# For local testing (optional - will use default hardhat node)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# For testnet deployment (add your keys here)
PRIVATE_KEY=your_private_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key

# Gas reporting
REPORT_GAS=true

# Contract verification
VERIFY_CONTRACTS=true
`;
  
  fs.writeFileSync(envPath, basicEnv);
  console.log('✅ Basic .env file created. You can edit it to add your API keys.\n');
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`🔧 Running: ${command} ${args.join(' ')}`);
    const process = spawn(command, args, { 
      stdio: 'inherit', 
      shell: true,
      ...options 
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

async function setup() {
  try {
    console.log('📦 Installing dependencies...');
    await runCommand('npm', ['install']);
    console.log('✅ Dependencies installed\n');

    console.log('🔨 Compiling contracts...');
    await runCommand('npx', ['hardhat', 'compile']);
    console.log('✅ Contracts compiled\n');

    console.log('🧪 Running tests...');
    await runCommand('npm', ['test']);
    console.log('✅ Tests passed\n');

    console.log('🎉 Setup completed successfully!\n');
    
    console.log('📋 Available commands:');
    console.log('  npm test                 - Run all tests');
    console.log('  npm run test:unit        - Run unit tests only');
    console.log('  npm run test:integration - Run integration tests only');
    console.log('  npm run node             - Start local Hardhat node');
    console.log('  npm run deploy:local     - Deploy to local network');
    console.log('  npm run deploy:sepolia   - Deploy to Sepolia testnet');
    console.log('  npm run compile          - Compile contracts');
    console.log('  npm run monitor          - Start monitoring system\n');
    
    console.log('🌐 Network configurations:');
    console.log('  • hardhat    - Local development (default)');
    console.log('  • localhost  - Local Hardhat node (npx hardhat node)');
    console.log('  • sepolia    - Ethereum Sepolia testnet');
    console.log('  • mumbai     - Polygon Mumbai testnet');
    console.log('  • arbitrumGoerli - Arbitrum Goerli testnet');
    console.log('  • optimismGoerli - Optimism Goerli testnet');
    console.log('  • baseGoerli - Base Goerli testnet\n');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setup(); 