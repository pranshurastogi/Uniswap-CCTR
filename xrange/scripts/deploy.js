const { ethers } = require("hardhat");
const { getChainConfig } = require("./config/chains");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = await deployer.getChainId();
  const chainConfig = getChainConfig(chainId);

  console.log(`Deploying to chain ID: ${chainId}`);
  console.log(`Deploying with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);

  // Deploy contracts in order
  const contracts = await deployContracts(deployer, chainConfig);
  
  // Configure contracts
  await configureContracts(contracts, chainConfig);
  
  // Verify contracts on block explorer
  if (process.env.VERIFY_CONTRACTS === "true") {
    await verifyContracts(contracts);
  }

  console.log("\n=== Deployment Summary ===");
  Object.entries(contracts).forEach(([name, contract]) => {
    console.log(`${name}: ${contract.address}`);
  });

  // Save deployment info
  await saveDeploymentInfo(contracts, chainId);
}

async function deployContracts(deployer, chainConfig) {
  console.log("\n=== Deploying Contracts ===");

  // 1. Deploy AcrossIntegration
  console.log("Deploying AcrossIntegration...");
  const AcrossIntegration = await ethers.getContractFactory("AcrossIntegration");
  const acrossIntegration = await AcrossIntegration.deploy(
    chainConfig.spokePool,
    chainConfig.priceOracle
  );
  await acrossIntegration.deployed();
  console.log(`AcrossIntegration deployed to: ${acrossIntegration.address}`);

  // 2. Deploy TrailingRangeHook
  console.log("Deploying TrailingRangeHook...");
  const TrailingRangeHook = await ethers.getContractFactory("TrailingRangeHook");
  const trailingRangeHook = await TrailingRangeHook.deploy(
    chainConfig.poolManager,
    acrossIntegration.address
  );
  await trailingRangeHook.deployed();
  console.log(`TrailingRangeHook deployed to: ${trailingRangeHook.address}`);

  // 3. Deploy additional supporting contracts if needed
  const contracts = {
    acrossIntegration,
    trailingRangeHook,
  };

  // Deploy mock contracts for testing if on local network
  if (chainId === 31337) {
    contracts.mockContracts = await deployMockContracts();
  }

  return contracts;
}

async function deployMockContracts() {
  console.log("Deploying mock contracts for testing...");
  
  // Mock PoolManager
  const MockPoolManager = await ethers.getContractFactory("MockPoolManager");
  const mockPoolManager = await MockPoolManager.deploy();
  await mockPoolManager.deployed();

  // Mock SpokePool
  const MockSpokePool = await ethers.getContractFactory("MockSpokePool");
  const mockSpokePool = await MockSpokePool.deploy();
  await mockSpokePool.deployed();

  // Mock Price Oracle
  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const mockPriceOracle = await MockPriceOracle.deploy();
  await mockPriceOracle.deployed();

  return {
    mockPoolManager,
    mockSpokePool,
    mockPriceOracle,
  };
}

async function configureContracts(contracts, chainConfig) {
  console.log("\n=== Configuring Contracts ===");

  const { acrossIntegration, trailingRangeHook } = contracts;

  // Configure AcrossIntegration with supported chains
  console.log("Configuring cross-chain support...");
  
  const supportedChains = [
    { chainId: 1, spokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5" },
    { chainId: 137, spokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096" },
    { chainId: 42161, spokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A" },
    { chainId: 10, spokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281" },
    { chainId: 8453, spokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64" },
  ];

  for (const chain of supportedChains) {
    try {
      await acrossIntegration.setSpokePool(chain.chainId, chain.spokePool);
      console.log(`Configured spoke pool for chain ${chain.chainId}`);
    } catch (error) {
      console.log(`Failed to configure chain ${chain.chainId}: ${error.message}`);
    }
  }

  // Configure TrailingRangeHook with initial cross-chain settings
  console.log("Configuring cross-chain parameters...");
  
  for (const chain of supportedChains) {
    try {
      await trailingRangeHook.setCrossChainConfig(
        chain.chainId,
        chain.spokePool,
        ethers.utils.parseUnits("50", "gwei"), // 50 gwei gas threshold
        100 // 1% yield threshold
      );
      console.log(`Configured cross-chain config for chain ${chain.chainId}`);
    } catch (error) {
      console.log(`Failed to configure cross-chain for ${chain.chainId}: ${error.message}`);
    }
  }

  // Set up authorized updaters for yield data
  if (process.env.YIELD_ORACLE_ADDRESS) {
    await acrossIntegration.setAuthorizedUpdater(process.env.YIELD_ORACLE_ADDRESS, true);
    console.log("Configured yield oracle updater");
  }
}

async function verifyContracts(contracts) {
  console.log("\n=== Verifying Contracts ===");

  for (const [name, contract] of Object.entries(contracts)) {
    if (name === "mockContracts") continue;
    
    try {
      console.log(`Verifying ${name}...`);
      await hre.run("verify:verify", {
        address: contract.address,
        constructorArguments: [], // Add constructor args if needed
      });
      console.log(`${name} verified successfully`);
    } catch (error) {
      console.log(`Failed to verify ${name}: ${error.message}`);
    }
  }
}

async function saveDeploymentInfo(contracts, chainId) {
  const fs = require("fs");
  const path = require("path");

  const deploymentInfo = {
    chainId,
    timestamp: new Date().toISOString(),
    contracts: {},
  };

  Object.entries(contracts).forEach(([name, contract]) => {
    if (name !== "mockContracts") {
      deploymentInfo.contracts[name] = {
        address: contract.address,
        transactionHash: contract.deployTransaction.hash,
      };
    }
  });

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `deployment-${chainId}-${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${filepath}`);
}

// Chain-specific configuration
function getChainConfig(chainId) {
  const configs = {
    1: { // Ethereum Mainnet
      poolManager: "0x...", // Uniswap V4 PoolManager address
      spokePool: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
      priceOracle: "0x...", // Price oracle address
    },
    137: { // Polygon
      poolManager: "0x...",
      spokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
      priceOracle: "0x...",
    },
    42161: { // Arbitrum
      poolManager: "0x...",
      spokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      priceOracle: "0x...",
    },
    10: { // Optimism
      poolManager: "0x...",
      spokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
      priceOracle: "0x...",
    },
    8453: { // Base
      poolManager: "0x...",
      spokePool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      priceOracle: "0x...",
    },
    31337: { // Hardhat local
      poolManager: "0x...", // Mock address
      spokePool: "0x...", // Mock address
      priceOracle: "0x...", // Mock address
    },
  };

  return configs[chainId] || configs[31337];
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });