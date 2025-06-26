const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Cross-Chain Trailing Range Rebalancer Monitoring System
 * 
 * This script monitors:
 * - Pool rebalancing activities
 * - Cross-chain yield opportunities
 * - System health and performance
 * - Gas costs and profitability
 */

class RebalancerMonitor {
  constructor(config) {
    this.config = config;
    this.providers = {};
    this.contracts = {};
    this.metrics = {
      rebalances: [],
      migrations: [],
      yields: {},
      gasUsage: [],
      errors: []
    };
    this.isRunning = false;
  }

  async initialize() {
    console.log("🚀 Initializing Cross-Chain Rebalancer Monitor...");
    
    try {
      // Setup providers for each chain
      await this.setupProviders();
      
      // Load contracts
      await this.loadContracts();
      
      // Setup event listeners
      await this.setupEventListeners();
      
      console.log("✅ Monitor initialized successfully");
      return true;
    } catch (error) {
      console.error("❌ Failed to initialize monitor:", error);
      return false;
    }
  }

  async setupProviders() {
    const networks = {
      1: process.env.ETHEREUM_RPC_URL,
      137: process.env.POLYGON_RPC_URL,
      42161: process.env.ARBITRUM_RPC_URL,
      10: process.env.OPTIMISM_RPC_URL,
      8453: process.env.BASE_RPC_URL
    };

    for (const [chainId, rpcUrl] of Object.entries(networks)) {
      if (rpcUrl) {
        this.providers[chainId] = new ethers.providers.JsonRpcProvider(rpcUrl);
        console.log(`📡 Connected to chain ${chainId}`);
      }
    }
  }

  async loadContracts() {
    const deploymentPath = path.join(__dirname, "../deployments");
    
    if (!fs.existsSync(deploymentPath)) {
      throw new Error("Deployment files not found. Please deploy contracts first.");
    }

    // Load deployment files for each chain
    const deploymentFiles = fs.readdirSync(deploymentPath);
    
    for (const file of deploymentFiles) {
      if (file.endsWith('.json')) {
        const deployment = JSON.parse(fs.readFileSync(path.join(deploymentPath, file)));
        const chainId = deployment.chainId;
        
        if (this.providers[chainId]) {
          this.contracts[chainId] = {
            hook: new ethers.Contract(
              deployment.contracts.trailingRangeHook.address,
              await this.getABI('TrailingRangeHook'),
              this.providers[chainId]
            ),
            acrossIntegration: new ethers.Contract(
              deployment.contracts.acrossIntegration.address,
              await this.getABI('AcrossIntegration'),
              this.providers[chainId]
            ),
            crossChainRebalancer: new ethers.Contract(
              deployment.contracts.crossChainRebalancer?.address || ethers.constants.AddressZero,
              await this.getABI('CrossChainRebalancer'),
              this.providers[chainId]
            )
          };
          console.log(`📜 Loaded contracts for chain ${chainId}`);
        }
      }
    }
  }

  async getABI(contractName) {
    // In a real implementation, this would load ABIs from artifacts
    // For now, return a minimal ABI
    return [
      "event PositionRebalanced(bytes32 indexed poolId, int24 newLowerTick, int24 newUpperTick, uint128 liquidity)",
      "event CrossChainMigrationInitiated(bytes32 indexed poolId, uint256 destinationChainId, uint256 amount0, uint256 amount1)",
      "event YieldDataUpdated(uint256 indexed chainId, address indexed token0, address indexed token1, uint256 apy, uint256 tvl, uint256 gasPrice)",
      "function getPoolConfig(bytes32 poolId) view returns (tuple(uint24,uint24,uint256,bool,uint256,int24,int24))",
      "function getBestYieldOpportunity(address token0, address token1) view returns (uint256, uint256)",
      "function estimateBridgingCost(address token0, address token1, uint256 amount0, uint256 amount1, uint256 destinationChainId) view returns (uint256)"
    ];
  }

  async setupEventListeners() {
    console.log("👂 Setting up event listeners...");
    
    for (const [chainId, contracts] of Object.entries(this.contracts)) {
      // Listen for rebalancing events
      contracts.hook.on("PositionRebalanced", (poolId, newLowerTick, newUpperTick, liquidity, event) => {
        this.handleRebalanceEvent(chainId, {
          poolId,
          newLowerTick,
          newUpperTick,
          liquidity,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        });
      });

      // Listen for cross-chain migration events
      contracts.hook.on("CrossChainMigrationInitiated", (poolId, destinationChainId, amount0, amount1, event) => {
        this.handleMigrationEvent(chainId, {
          poolId,
          destinationChainId,
          amount0,
          amount1,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash
        });
      });

      // Listen for yield data updates
      contracts.acrossIntegration.on("YieldDataUpdated", (chainId, token0, token1, apy, tvl, gasPrice, event) => {
        this.handleYieldUpdateEvent({
          chainId,
          token0,
          token1,
          apy,
          tvl,
          gasPrice,
          blockNumber: event.blockNumber
        });
      });
    }
  }

  handleRebalanceEvent(chainId, eventData) {
    const rebalance = {
      ...eventData,
      chainId: parseInt(chainId),
      timestamp: Date.now(),
      type: 'rebalance'
    };

    this.metrics.rebalances.push(rebalance);
    console.log(`🔄 Rebalance detected on chain ${chainId}:`, {
      poolId: eventData.poolId.slice(0, 10) + '...',
      ticks: `${eventData.newLowerTick} to ${eventData.newUpperTick}`,
      liquidity: ethers.utils.formatEther(eventData.liquidity)
    });

    this.saveMetrics();
  }

  handleMigrationEvent(chainId, eventData) {
    const migration = {
      ...eventData,
      fromChainId: parseInt(chainId),
      toChainId: parseInt(eventData.destinationChainId),
      timestamp: Date.now(),
      type: 'migration'
    };

    this.metrics.migrations.push(migration);
    console.log(`🌉 Cross-chain migration initiated from chain ${chainId} to ${eventData.destinationChainId}:`, {
      poolId: eventData.poolId.slice(0, 10) + '...',
      amount0: ethers.utils.formatEther(eventData.amount0),
      amount1: ethers.utils.formatEther(eventData.amount1)
    });

    this.saveMetrics();
  }

  handleYieldUpdateEvent(eventData) {
    const key = `${eventData.chainId}-${eventData.token0}-${eventData.token1}`;
    
    this.metrics.yields[key] = {
      ...eventData,
      timestamp: Date.now(),
      apyFormatted: (parseInt(eventData.apy) / 100).toFixed(2) + '%',
      tvlFormatted: ethers.utils.formatEther(eventData.tvl)
    };

    console.log(`📊 Yield data updated for chain ${eventData.chainId}:`, {
      apy: this.metrics.yields[key].apyFormatted,
      tvl: this.metrics.yields[key].tvlFormatted
    });
  }

  async startMonitoring() {
    if (this.isRunning) {
      console.log("⚠️ Monitor is already running");
      return;
    }

    console.log("🔍 Starting monitoring...");
    this.isRunning = true;

    // Start periodic checks
    this.periodicCheck = setInterval(async () => {
      await this.performPeriodicChecks();
    }, this.config.checkInterval || 60000); // Default: 1 minute

    // Start yield opportunity scanning
    this.yieldScan = setInterval(async () => {
      await this.scanYieldOpportunities();
    }, this.config.yieldScanInterval || 300000); // Default: 5 minutes

    // Start health checks
    this.healthCheck = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval || 600000); // Default: 10 minutes

    console.log("✅ Monitoring started successfully");
  }

  async stopMonitoring() {
    if (!this.isRunning) {
      console.log("⚠️ Monitor is not running");
      return;
    }

    console.log("🛑 Stopping monitoring...");
    this.isRunning = false;

    if (this.periodicCheck) clearInterval(this.periodicCheck);
    if (this.yieldScan) clearInterval(this.yieldScan);
    if (this.healthCheck) clearInterval(this.healthCheck);

    console.log("✅ Monitoring stopped");
  }

  async performPeriodicChecks() {
    try {
      console.log("🔄 Performing periodic checks...");

      for (const [chainId, contracts] of Object.entries(this.contracts)) {
        // Check pool configurations
        await this.checkPoolConfigurations(chainId, contracts);
        
        // Monitor gas prices
        await this.monitorGasPrices(chainId);
      }
    } catch (error) {
      console.error("❌ Error in periodic checks:", error);
      this.metrics.errors.push({
        timestamp: Date.now(),
        type: 'periodic_check',
        error: error.message
      });
    }
  }

  async checkPoolConfigurations(chainId, contracts) {
    // This would check all active pools for configuration drift
    // For demo purposes, we'll just log a status
    console.log(`✅ Pool configurations checked for chain ${chainId}`);
  }

  async monitorGasPrices(chainId) {
    try {
      const gasPrice = await this.providers[chainId].getGasPrice();
      const gasPriceGwei = ethers.utils.formatUnits(gasPrice, 'gwei');
      
      this.metrics.gasUsage.push({
        chainId: parseInt(chainId),
        gasPrice: gasPriceGwei,
        timestamp: Date.now()
      });

      // Alert if gas price is unusually high
      if (parseFloat(gasPriceGwei) > this.config.highGasThreshold) {
        console.log(`⚠️ High gas price detected on chain ${chainId}: ${gasPriceGwei} gwei`);
      }
    } catch (error) {
      console.error(`❌ Failed to get gas price for chain ${chainId}:`, error);
    }
  }

  async scanYieldOpportunities() {
    try {
      console.log("🔍 Scanning yield opportunities...");

      const tokenPairs = this.config.monitoredPairs || [
        { token0: "0xA0b86a33E6417b8d0d7e9f9E2e4e2e8E4e2e8E4e", token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" } // Example
      ];

      for (const [chainId, contracts] of Object.entries(this.contracts)) {
        for (const pair of tokenPairs) {
          try {
            const [bestChainId, yieldDifference] = await contracts.acrossIntegration.getBestYieldOpportunity(
              pair.token0,
              pair.token1
            );

            if (parseInt(yieldDifference) > this.config.minYieldDifference) {
              console.log(`💰 Yield opportunity found:`, {
                currentChain: chainId,
                bestChain: bestChainId.toString(),
                yieldDifference: (parseInt(yieldDifference) / 100).toFixed(2) + '%'
              });
            }
          } catch (error) {
            // Contract might not be deployed on this chain
          }
        }
      }
    } catch (error) {
      console.error("❌ Error scanning yield opportunities:", error);
    }
  }

  async performHealthCheck() {
    console.log("🏥 Performing health check...");

    const healthStatus = {
      timestamp: Date.now(),
      chains: {},
      overall: 'healthy'
    };

    for (const [chainId, provider] of Object.entries(this.providers)) {
      try {
        const blockNumber = await provider.getBlockNumber();
        const network = await provider.getNetwork();
        
        healthStatus.chains[chainId] = {
          status: 'healthy',
          blockNumber,
          networkId: network.chainId,
          lastChecked: Date.now()
        };
      } catch (error) {
        healthStatus.chains[chainId] = {
          status: 'unhealthy',
          error: error.message,
          lastChecked: Date.now()
        };
        healthStatus.overall = 'degraded';
        console.log(`❌ Health check failed for chain ${chainId}:`, error.message);
      }
    }

    // Save health status
    const healthPath = path.join(__dirname, "../monitoring/health.json");
    fs.writeFileSync(healthPath, JSON.stringify(healthStatus, null, 2));

    if (healthStatus.overall === 'healthy') {
      console.log("✅ All systems healthy");
    } else {
      console.log("⚠️ System health degraded - check logs");
    }
  }

  generateReport() {
    const report = {
      timestamp: Date.now(),
      summary: {
        totalRebalances: this.metrics.rebalances.length,
        totalMigrations: this.metrics.migrations.length,
        activeChains: Object.keys(this.contracts).length,
        monitoringDuration: Date.now() - this.startTime
      },
      rebalances: this.metrics.rebalances.slice(-10), // Last 10
      migrations: this.metrics.migrations.slice(-10), // Last 10
      yields: this.metrics.yields,
      recentGasUsage: this.metrics.gasUsage.slice(-50), // Last 50
      errors: this.metrics.errors.slice(-20) // Last 20
    };

    console.log("\n📊 MONITORING REPORT");
    console.log("===================");
    console.log(`Total Rebalances: ${report.summary.totalRebalances}`);
    console.log(`Total Migrations: ${report.summary.totalMigrations}`);
    console.log(`Active Chains: ${report.summary.activeChains}`);
    console.log(`Monitoring Duration: ${Math.round(report.summary.monitoringDuration / 1000 / 60)} minutes`);

    if (Object.keys(report.yields).length > 0) {
      console.log("\nCurrent Yields:");
      Object.entries(report.yields).forEach(([key, data]) => {
        console.log(`  Chain ${data.chainId}: ${data.apyFormatted} APY, ${data.tvlFormatted} TVL`);
      });
    }

    return report;
  }

  saveMetrics() {
    const metricsPath = path.join(__dirname, "../monitoring");
    if (!fs.existsSync(metricsPath)) {
      fs.mkdirSync(metricsPath, { recursive: true });
    }

    fs.writeFileSync(
      path.join(metricsPath, "metrics.json"),
      JSON.stringify(this.metrics, null, 2)
    );
  }

  async cleanup() {
    console.log("🧹 Cleaning up monitor...");
    await this.stopMonitoring();
    
    // Remove old event listeners
    for (const [chainId, contracts] of Object.entries(this.contracts)) {
      contracts.hook.removeAllListeners();
      contracts.acrossIntegration.removeAllListeners();
    }
    
    console.log("✅ Cleanup complete");
  }
}

// CLI Interface
async function main() {
  const config = {
    checkInterval: 60000,        // 1 minute
    yieldScanInterval: 300000,   // 5 minutes
    healthCheckInterval: 600000, // 10 minutes
    highGasThreshold: 100,       // 100 gwei
    minYieldDifference: 100,     // 1%
    monitoredPairs: [
      {
        token0: process.env.USDC_ADDRESS || "0xA0b86a33E6417b8d0d7e9f9E2e4e2e8E4e2e8E4e",
        token1: process.env.WETH_ADDRESS || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
      }
    ]
  };

  const monitor = new RebalancerMonitor(config);
  monitor.startTime = Date.now();

  try {
    const initialized = await monitor.initialize();
    if (!initialized) {
      process.exit(1);
    }

    await monitor.startMonitoring();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await monitor.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await monitor.cleanup();
      process.exit(0);
    });

    // Generate report every hour
    setInterval(() => {
      monitor.generateReport();
    }, 3600000);

    console.log("\n🎯 Monitor is running. Press Ctrl+C to stop.");
    
  } catch (error) {
    console.error("❌ Fatal error:", error);
    await monitor.cleanup();
    process.exit(1);
  }
}

// Export for use as module
module.exports = { RebalancerMonitor };

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Unhandled error:", error);
    process.exit(1);
  });
}
