const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Cross-Chain Trailing Range Rebalancer - Integration Tests", function () {
  async function deployIntegrationFixture() {
    const [owner, liquidityProvider, trader, relayer] = await ethers.getSigners();

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const USDC = await MockERC20.deploy("USD Coin", "USDC", 6);
    const WETH = await MockERC20.deploy("Wrapped Ether", "WETH", 18);

    // Deploy mock Uniswap V4 PoolManager
    const MockPoolManager = await ethers.getContractFactory("MockPoolManager");
    const poolManager = await MockPoolManager.deploy();

    // Deploy AcrossIntegration
    const mockSpokePool = await ethers.Wallet.createRandom().getAddress();
    const mockPriceOracle = await ethers.Wallet.createRandom().getAddress();
    
    const AcrossIntegration = await ethers.getContractFactory("AcrossIntegration");
    const acrossIntegration = await AcrossIntegration.deploy(
      mockSpokePool,
      mockPriceOracle,
      owner.address
    );

    // Deploy CrossChainRebalancer
    const CrossChainRebalancer = await ethers.getContractFactory("CrossChainRebalancer");
    const crossChainRebalancer = await CrossChainRebalancer.deploy(
      acrossIntegration.address,
      owner.address
    );

    // Deploy TrailingRangeHook
    const TrailingRangeHook = await ethers.getContractFactory("TrailingRangeHook");
    const hook = await TrailingRangeHook.deploy(
      poolManager.address,
      acrossIntegration.address
    );

    // Setup initial token balances
    const initialBalance = ethers.utils.parseUnits("1000000", 18);
    await USDC.mint(liquidityProvider.address, ethers.utils.parseUnits("1000000", 6));
    await WETH.mint(liquidityProvider.address, initialBalance);
    await USDC.mint(trader.address, ethers.utils.parseUnits("100000", 6));
    await WETH.mint(trader.address, ethers.utils.parseEther("100"));

    // Create pool configuration
    const poolKey = {
      currency0: USDC.address,
      currency1: WETH.address,
      fee: 3000, // 0.3%
      tickSpacing: 60,
      hooks: hook.address
    };

    const poolId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["tuple(address,address,uint24,int24,address)"],
        [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
      )
    );

    // Initialize pool with 1 ETH = 2000 USDC price
    const initialSqrtPrice = "3543191142285914205922034323"; // sqrt(2000) * 2^96
    const initialTick = 69077; // log_1.0001(2000)

    await poolManager.setSlot0(poolId, {
      sqrtPriceX96: initialSqrtPrice,
      tick: initialTick,
      observationIndex: 0,
      observationCardinality: 1
    });

    // Initialize hook
    await hook.afterInitialize(
      ethers.constants.AddressZero,
      poolKey,
      initialSqrtPrice,
      initialTick,
      "0x"
    );

    // Setup cross-chain configurations
    const supportedChains = [
      { chainId: 1, name: "Ethereum", spokePool: mockSpokePool },
      { chainId: 137, name: "Polygon", spokePool: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096" },
      { chainId: 42161, name: "Arbitrum", spokePool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A" },
      { chainId: 10, name: "Optimism", spokePool: "0x6f26Bf09B1C792e3228e5467807a900A503c0281" }
    ];

    for (const chain of supportedChains) {
      await acrossIntegration.setSpokePool(chain.chainId, chain.spokePool);
      await crossChainRebalancer.setSupportedChain(chain.chainId, true);
      
      await hook.setCrossChainConfig(
        chain.chainId,
        chain.spokePool,
        ethers.utils.parseUnits("50", "gwei"), // 50 gwei gas threshold
        100 // 1% yield threshold
      );
    }

    return {
      owner,
      liquidityProvider,
      trader,
      relayer,
      USDC,
      WETH,
      poolManager,
      acrossIntegration,
      crossChainRebalancer,
      hook,
      poolKey,
      poolId,
      supportedChains
    };
  }

  describe("Full System Integration", function () {
    it("Should initialize and configure the entire system", async function () {
      const {
        hook,
        acrossIntegration,
        crossChainRebalancer,
        poolId,
        supportedChains
      } = await loadFixture(deployIntegrationFixture);

      // Verify hook configuration
      const poolConfig = await hook.poolConfigs(poolId);
      expect(poolConfig.rebalanceThreshold).to.equal(100);
      expect(poolConfig.rangeWidth).to.equal(60);
      expect(poolConfig.crossChainEnabled).to.be.true;

      // Verify cross-chain configurations
      for (const chain of supportedChains) {
        const config = await hook.crossChainConfigs(chain.chainId);
        expect(config.spokePool).to.equal(chain.spokePool);
      }

      // Verify supported chains
      expect(await crossChainRebalancer.supportedChains(137)).to.be.true;
      expect(await crossChainRebalancer.supportedChains(42161)).to.be.true;
    });

    it("Should handle liquidity provision and position management", async function () {
      const {
        hook,
        poolManager,
        poolKey,
        poolId,
        USDC,
        WETH,
        liquidityProvider
      } = await loadFixture(deployIntegrationFixture);

      // Approve tokens for the hook
      await USDC.connect(liquidityProvider).approve(hook.address, ethers.utils.parseUnits("10000", 6));
      await WETH.connect(liquidityProvider).approve(hook.address, ethers.utils.parseEther("5"));

      // Simulate adding liquidity through the pool manager
      const liquidityParams = {
        tickLower: 69000, // Around current price
        tickUpper: 69200,
        liquidityDelta: ethers.utils.parseEther("1"), // 1 ETH worth of liquidity
        salt: ethers.constants.HashZero
      };

      // Mock the beforeAddLiquidity call
      await hook.beforeAddLiquidity(
        liquidityProvider.address,
        poolKey,
        liquidityParams,
        "0x"
      );

      // Verify position was accepted
      const config = await hook.poolConfigs(poolId);
      expect(config.currentLowerTick).to.be.lte(liquidityParams.tickLower);
      expect(config.currentUpperTick).to.be.gte(liquidityParams.tickUpper);
    });
  });

  describe("Rebalancing Scenarios", function () {
    it("Should trigger rebalancing when price moves significantly", async function () {
      const {
        hook,
        poolManager,
        poolKey,
        poolId,
        trader
      } = await loadFixture(deployIntegrationFixture);

      // Get initial position
      const initialConfig = await hook.poolConfigs(poolId);
      const initialLowerTick = initialConfig.currentLowerTick;
      const initialUpperTick = initialConfig.currentUpperTick;

      // Simulate price movement - ETH price goes to $2500
      const newSqrtPrice = "3952847075210473105607010647"; // sqrt(2500) * 2^96
      const newTick = 72387; // log_1.0001(2500)

      await poolManager.setSlot0(poolId, {
        sqrtPriceX96: newSqrtPrice,
        tick: newTick,
        observationIndex: 0,
        observationCardinality: 1
      });

      // Trigger rebalancing through a swap simulation
      const swapParams = {
        zeroForOne: true,
        amountSpecified: ethers.utils.parseEther("1"),
        sqrtPriceLimitX96: 0
      };

      // Call beforeSwap to trigger rebalancing check
      await hook.beforeSwap(
        trader.address,
        poolKey,
        swapParams,
        "0x"
      );

      // Verify position was rebalanced
      const newConfig = await hook.poolConfigs(poolId);
      expect(newConfig.lastRebalanceBlock).to.be.gt(initialConfig.lastRebalanceBlock);
    });

    it("Should respect rebalance cooldown period", async function () {
      const {
        hook,
        poolManager,
        poolKey,
        poolId,
        trader
      } = await loadFixture(deployIntegrationFixture);

      // First rebalance
      const newTick = 72387;
      await poolManager.setSlot0(poolId, {
        sqrtPriceX96: "3952847075210473105607010647",
        tick: newTick,
        observationIndex: 0,
        observationCardinality: 1
      });

      const swapParams = {
        zeroForOne: true,
        amountSpecified: ethers.utils.parseEther("1"),
        sqrtPriceLimitX96: 0
      };

      await hook.beforeSwap(trader.address, poolKey, swapParams, "0x");
      const firstRebalanceBlock = (await hook.poolConfigs(poolId)).lastRebalanceBlock;

      // Immediate second attempt - should be rejected due to cooldown
      await hook.beforeSwap(trader.address, poolKey, swapParams, "0x");
      const secondRebalanceBlock = (await hook.poolConfigs(poolId)).lastRebalanceBlock;

      expect(secondRebalanceBlock).to.equal(firstRebalanceBlock);
    });
  });

  describe("Cross-Chain Migration Scenarios", function () {
    it("Should detect better yield opportunities on other chains", async function () {
      const {
        acrossIntegration,
        USDC,
        WETH,
        owner
      } = await loadFixture(deployIntegrationFixture);

      // Set up yield data for different chains
      const yieldData = [
        { chainId: 1, apy: 500, tvl: ethers.utils.parseEther("1000000"), gasPrice: ethers.utils.parseUnits("30", "gwei") },
        { chainId: 137, apy: 800, tvl: ethers.utils.parseEther("500000"), gasPrice: ethers.utils.parseUnits("2", "gwei") },
        { chainId: 42161, apy: 650, tvl: ethers.utils.parseEther("800000"), gasPrice: ethers.utils.parseUnits("0.1", "gwei") }
      ];

      for (const data of yieldData) {
        await acrossIntegration.connect(owner).updateYieldData(
          data.chainId,
          USDC.address,
          WETH.address,
          data.apy,
          data.tvl,
          data.gasPrice
        );
      }

      // Check best yield opportunity
      const [bestChainId, yieldDifference] = await acrossIntegration.getBestYieldOpportunity(
        USDC.address,
        WETH.address
      );

      expect(bestChainId).to.equal(137); // Polygon has highest yield
      expect(yieldDifference).to.equal(300); // 8% - 5% = 3%
    });

    it("Should execute profitable cross-chain migration", async function () {
      const {
        crossChainRebalancer,
        acrossIntegration,
        USDC,
        WETH,
        liquidityProvider,
        owner
      } = await loadFixture(deployIntegrationFixture);

      // Setup yield data showing Polygon is more profitable
      await acrossIntegration.connect(owner).updateYieldData(
        1, USDC.address, WETH.address, 400, ethers.utils.parseEther("1000000"), ethers.utils.parseUnits("30", "gwei")
      );
      await acrossIntegration.connect(owner).updateYieldData(
        137, USDC.address, WETH.address, 800, ethers.utils.parseEther("500000"), ethers.utils.parseUnits("2", "gwei")
      );

      // Approve tokens for migration
      const migrationAmount = ethers.utils.parseUnits("10000", 6); // 10k USDC
      await USDC.connect(liquidityProvider).approve(crossChainRebalancer.address, migrationAmount);
      await WETH.connect(liquidityProvider).approve(crossChainRebalancer.address, ethers.utils.parseEther("5"));

      // Check if migration would be profitable
      const [isProfitable, profitEstimate] = await acrossIntegration.isMigrationProfitable(
        1, // from Ethereum
        137, // to Polygon
        USDC.address,
        WETH.address,
        migrationAmount
      );

      expect(isProfitable).to.be.true;
      expect(profitEstimate).to.be.gt(0);

      // Initiate migration
      const tx = await crossChainRebalancer.connect(liquidityProvider).initiateMigration(
        USDC.address,
        WETH.address,
        migrationAmount,
        ethers.utils.parseEther("5"),
        137 // target chain: Polygon
      );

      await expect(tx).to.emit(crossChainRebalancer, "MigrationInitiated");
    });

    it("Should reject unprofitable migrations", async function () {
      const {
        crossChainRebalancer,
        acrossIntegration,
        USDC,
        WETH,
        liquidityProvider,
        owner
      } = await loadFixture(deployIntegrationFixture);

      // Setup yield data where migration is not profitable
      await acrossIntegration.connect(owner).updateYieldData(
        1, USDC.address, WETH.address, 800, ethers.utils.parseEther("1000000"), ethers.utils.parseUnits("30", "gwei")
      );
      await acrossIntegration.connect(owner).updateYieldData(
        137, USDC.address, WETH.address, 820, ethers.utils.parseEther("500000"), ethers.utils.parseUnits("2", "gwei")
      );

      const migrationAmount = ethers.utils.parseUnits("1000", 6); // Small amount
      await USDC.connect(liquidityProvider).approve(crossChainRebalancer.address, migrationAmount);

      // Migration should be rejected as not profitable
      await expect(
        crossChainRebalancer.connect(liquidityProvider).initiateMigration(
          USDC.address,
          WETH.address,
          migrationAmount,
          ethers.utils.parseEther("0.5"),
          137
        )
      ).to.be.revertedWith("Migration not profitable");
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle extreme price movements gracefully", async function () {
      const {
        hook,
        poolManager,
        poolKey,
        poolId,
        trader
      } = await loadFixture(deployIntegrationFixture);

      // Simulate extreme price crash - ETH to $100
      const crashSqrtPrice = "790569415042094510"; // sqrt(100) * 2^96
      const crashTick = 46052; // log_1.0001(100)

      await poolManager.setSlot0(poolId, {
        sqrtPriceX96: crashSqrtPrice,
        tick: crashTick,
        observationIndex: 0,
        observationCardinality: 1
      });

      // Hook should handle this gracefully
      const swapParams = {
        zeroForOne: false,
        amountSpecified: ethers.utils.parseEther("1"),
        sqrtPriceLimitX96: 0
      };

      await expect(
        hook.beforeSwap(trader.address, poolKey, swapParams, "0x")
      ).to.not.be.reverted;
    });

    it("Should handle network congestion and high gas prices", async function () {
      const {
        acrossIntegration,
        crossChainRebalancer,
        USDC,
        WETH,
        owner
      } = await loadFixture(deployIntegrationFixture);

      // Setup scenario with high gas prices
      await acrossIntegration.connect(owner).updateYieldData(
        1, USDC.address, WETH.address, 500, ethers.utils.parseEther("1000000"), ethers.utils.parseUnits("200", "gwei")
      );
      await acrossIntegration.connect(owner).updateYieldData(
        137, USDC.address, WETH.address, 700, ethers.utils.parseEther("500000"), ethers.utils.parseUnits("100", "gwei")
      );

      // Even with better yield, high gas prices should make migration unprofitable for small amounts
      const [isProfitable] = await acrossIntegration.isMigrationProfitable(
        1, 137, USDC.address, WETH.address, ethers.utils.parseUnits("100", 6)
      );

      expect(isProfitable).to.be.false;
    });

    it("Should handle emergency pause scenarios", async function () {
      const {
        hook,
        crossChainRebalancer,
        acrossIntegration,
        owner,
        poolId
      } = await loadFixture(deployIntegrationFixture);

      // Emergency pause the system
      await acrossIntegration.connect(owner).pauseBridging();
      await crossChainRebalancer.connect(owner).pause();

      // Operations should be paused
      expect(await acrossIntegration.isBridgingPaused()).to.be.true;

      // Emergency withdraw should still work
      await expect(
        hook.connect(owner).emergencyWithdraw(poolId)
      ).to.not.be.reverted;
    });
  });

  describe("Performance and Gas Optimization", function () {
    it("Should maintain reasonable gas costs for rebalancing", async function () {
      const {
        hook,
        poolManager,
        poolKey,
        trader
      } = await loadFixture(deployIntegrationFixture);

      // Setup price movement
      await poolManager.setSlot0("0x" + "0".repeat(64), {
        sqrtPriceX96: "3952847075210473105607010647",
        tick: 72387,
        observationIndex: 0,
        observationCardinality: 1
      });

      const swapParams = {
        zeroForOne: true,
        amountSpecified: ethers.utils.parseEther("1"),
        sqrtPriceLimitX96: 0
      };

      // Measure gas usage
      const tx = await hook.beforeSwap(trader.address, poolKey, swapParams, "0x");
      const receipt = await tx.wait();

      // Gas should be reasonable (less than 500k for complex operations)
      expect(receipt.gasUsed).to.be.lt(500000);
    });

    it("Should batch multiple operations efficiently", async function () {
      const {
        acrossIntegration,
        USDC,
        WETH,
        owner
      } = await loadFixture(deployIntegrationFixture);

      const startTime = Date.now();

      // Batch update yield data for multiple chains
      const updatePromises = [];
      for (let i = 1; i <= 5; i++) {
        updatePromises.push(
          acrossIntegration.connect(owner).updateYieldData(
            i, USDC.address, WETH.address, 500 + i * 50, ethers.utils.parseEther("1000000"), ethers.utils.parseUnits("30", "gwei")
          )
        );
      }

      await Promise.all(updatePromises);
      const endTime = Date.now();

      // Should complete efficiently
      expect(endTime - startTime).to.be.lt(10000); // Less than 10 seconds
    });
  });

  describe("Real-world Scenarios", function () {
    it("Should handle a complete day of trading activity", async function () {
      const {
        hook,
        poolManager,
        poolKey,
        poolId,
        trader,
        USDC,
        WETH
      } = await loadFixture(deployIntegrationFixture);

      // Simulate 24 hours of price movements and trades
      const priceUpdates = [
        { price: 2000, tick: 69077 },
        { price: 2100, tick: 69559 },
        { price: 1950, tick: 68839 },
        { price: 2200, tick: 70026 },
        { price: 2050, tick: 69315 }
      ];

      let rebalanceCount = 0;
      const initialConfig = await hook.poolConfigs(poolId);
      let lastRebalanceBlock = initialConfig.lastRebalanceBlock;

      for (const update of priceUpdates) {
        // Update price
        const sqrtPrice = Math.sqrt(update.price).toString();
        await poolManager.setSlot0(poolId, {
          sqrtPriceX96: ethers.BigNumber.from(sqrtPrice).mul(ethers.BigNumber.from(2).pow(96)).toString(),
          tick: update.tick,
          observationIndex: 0,
          observationCardinality: 1
        });

        // Simulate trade
        const swapParams = {
          zeroForOne: Math.random() > 0.5,
          amountSpecified: ethers.utils.parseEther((Math.random() * 5).toString()),
          sqrtPriceLimitX96: 0
        };

        await hook.beforeSwap(trader.address, poolKey, swapParams, "0x");

        // Check if rebalancing occurred
        const currentConfig = await hook.poolConfigs(poolId);
        if (currentConfig.lastRebalanceBlock.gt(lastRebalanceBlock)) {
          rebalanceCount++;
          lastRebalanceBlock = currentConfig.lastRebalanceBlock;
        }

        // Advance time
        await time.increase(3600); // 1 hour
      }

      // Should have rebalanced at least once during the day
      expect(rebalanceCount).to.be.gt(0);
    });

    it("Should handle multiple token pairs simultaneously", async function () {
      const {
        hook,
        poolManager,
        owner,
        liquidityProvider
      } = await loadFixture(deployIntegrationFixture);

      // Deploy additional tokens
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const DAI = await MockERC20.deploy("DAI Stablecoin", "DAI", 18);
      const LINK = await MockERC20.deploy("Chainlink", "LINK", 18);

      // Create additional pool
      const daiLinkPoolKey = {
        currency0: DAI.address,
        currency1: LINK.address,
        fee: 3000,
        tickSpacing: 60,
        hooks: hook.address
      };

      const daiLinkPoolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[daiLinkPoolKey.currency0, daiLinkPoolKey.currency1, daiLinkPoolKey.fee, daiLinkPoolKey.tickSpacing, daiLinkPoolKey.hooks]]
        )
      );

      // Initialize new pool
      await poolManager.setSlot0(daiLinkPoolId, {
        sqrtPriceX96: "79228162514264337593543950336", // 1:1 price
        tick: 0,
        observationIndex: 0,
        observationCardinality: 1
      });

      await hook.afterInitialize(
        ethers.constants.AddressZero,
        daiLinkPoolKey,
        "79228162514264337593543950336",
        0,
        "0x"
      );

      // Configure the new pool
      await hook.connect(owner).setPoolConfig(
        daiLinkPoolId,
        150, // 1.5% rebalance threshold
        80,  // 80 ticks range width
        true // cross-chain enabled
      );

      // Verify both pools are configured independently
      const usdcEthConfig = await hook.poolConfigs(daiLinkPoolId);
      expect(usdcEthConfig.rebalanceThreshold).to.equal(150);
      expect(usdcEthConfig.rangeWidth).to.equal(80);
    });
  });
});
