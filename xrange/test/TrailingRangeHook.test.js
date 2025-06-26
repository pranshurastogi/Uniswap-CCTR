const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("TrailingRangeHook", function () {
  async function deployFixture() {
    // Get signers
    const [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock contracts
    const MockPoolManager = await ethers.getContractFactory("MockPoolManager");
    const mockPoolManager = await MockPoolManager.deploy();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token0 = await MockERC20.deploy("Token0", "TK0", 18);
    const token1 = await MockERC20.deploy("Token1", "TK1", 18);

    // Deploy AcrossIntegration mock
    const MockAcrossIntegration = await ethers.getContractFactory("MockAcrossIntegration");
    const acrossIntegration = await MockAcrossIntegration.deploy();

    // Deploy TrailingRangeHook
    const TrailingRangeHook = await ethers.getContractFactory("TrailingRangeHook");
    const hook = await TrailingRangeHook.deploy(
      mockPoolManager.address,
      acrossIntegration.address
    );

    // Mint tokens to users
    const initialBalance = ethers.utils.parseEther("1000");
    await token0.mint(user1.address, initialBalance);
    await token1.mint(user1.address, initialBalance);
    await token0.mint(user2.address, initialBalance);
    await token1.mint(user2.address, initialBalance);

    // Create a mock pool key
    const poolKey = {
      currency0: token0.address,
      currency1: token1.address,
      fee: 3000,
      tickSpacing: 60,
      hooks: hook.address
    };

    return {
      hook,
      mockPoolManager,
      acrossIntegration,
      token0,
      token1,
      poolKey,
      owner,
      user1,
      user2,
      user3
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct initial parameters", async function () {
      const { hook, mockPoolManager, acrossIntegration, owner } = await loadFixture(deployFixture);

      expect(await hook.poolManager()).to.equal(mockPoolManager.address);
      expect(await hook.acrossIntegration()).to.equal(acrossIntegration.address);
      expect(await hook.owner()).to.equal(owner.address);
    });

    it("Should have correct hook permissions", async function () {
      const { hook } = await loadFixture(deployFixture);

      const permissions = await hook.getHookPermissions();
      expect(permissions.beforeInitialize).to.be.false;
      expect(permissions.afterInitialize).to.be.true;
      expect(permissions.beforeAddLiquidity).to.be.true;
      expect(permissions.afterAddLiquidity).to.be.false;
      expect(permissions.beforeSwap).to.be.true;
      expect(permissions.afterSwap).to.be.true;
    });
  });

  describe("Pool Configuration", function () {
    it("Should set pool configuration correctly", async function () {
      const { hook, poolKey, owner } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      await hook.connect(owner).setPoolConfig(
        poolId,
        200, // 2% rebalance threshold
        120, // 120 ticks range width
        true // cross-chain enabled
      );

      const config = await hook.poolConfigs(poolId);
      expect(config.rebalanceThreshold).to.equal(200);
      expect(config.rangeWidth).to.equal(120);
      expect(config.crossChainEnabled).to.be.true;
    });

    it("Should only allow owner to set pool configuration", async function () {
      const { hook, poolKey, user1 } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      await expect(
        hook.connect(user1).setPoolConfig(poolId, 200, 120, true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should set cross-chain configuration", async function () {
      const { hook, owner } = await loadFixture(deployFixture);

      const chainId = 137; // Polygon
      const spokePool = "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096";
      const gasThreshold = ethers.utils.parseUnits("50", "gwei");
      const yieldThreshold = 100; // 1%

      await hook.connect(owner).setCrossChainConfig(
        chainId,
        spokePool,
        gasThreshold,
        yieldThreshold
      );

      const config = await hook.crossChainConfigs(chainId);
      expect(config.spokePool).to.equal(spokePool);
      expect(config.gasThreshold).to.equal(gasThreshold);
      expect(config.yieldThreshold).to.equal(yieldThreshold);
    });
  });

  describe("Rebalancing Logic", function () {
    beforeEach(async function () {
      const { hook, poolKey, mockPoolManager } = await loadFixture(deployFixture);
      
      // Initialize the pool
      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      // Mock pool initialization
      await mockPoolManager.setSlot0(poolId, {
        sqrtPriceX96: "79228162514264337593543950336", // 1:1 price
        tick: 0,
        observationIndex: 0,
        observationCardinality: 1
      });

      // Initialize the hook for this pool
      await hook.afterInitialize(
        ethers.constants.AddressZero,
        poolKey,
        "79228162514264337593543950336",
        0,
        "0x"
      );
    });

    it("Should initialize pool with default configuration", async function () {
      const { hook, poolKey } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      const config = await hook.poolConfigs(poolId);
      expect(config.rebalanceThreshold).to.equal(100); // 1%
      expect(config.rangeWidth).to.equal(60); // 60 ticks
      expect(config.crossChainEnabled).to.be.true;
    });

    it("Should detect when rebalancing is needed", async function () {
      const { hook, poolKey, mockPoolManager } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      // Move price significantly
      await mockPoolManager.setSlot0(poolId, {
        sqrtPriceX96: "88796558772296502502737536000", // Higher price
        tick: 200,
        observationIndex: 0,
        observationCardinality: 1
      });

      // Check if rebalancing is needed (this would be part of the beforeSwap hook)
      // In a real test, we'd call beforeSwap and check for the PositionRebalanced event
    });
  });

  describe("Cross-Chain Migration", function () {
    it("Should initiate cross-chain migration when profitable", async function () {
      const { hook, acrossIntegration, poolKey } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      // Mock better yield opportunity on another chain
      await acrossIntegration.setBestYieldOpportunity(
        poolKey.currency0,
        poolKey.currency1,
        137, // Polygon chain ID
        500  // 5% better yield
      );

      // Trigger cross-chain monitoring (normally done in afterSwap)
      // This would initiate migration if profitable
    });

    it("Should emit CrossChainMigrationInitiated event", async function () {
      const { hook, poolKey, acrossIntegration } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      // Setup liquidity first
      await hook.setLiquidityForTesting(poolId, ethers.utils.parseEther("100"));

      await acrossIntegration.setBestYieldOpportunity(
        poolKey.currency0,
        poolKey.currency1,
        137,
        1000 // 10% better yield to ensure migration
      );

      // Would need to call the internal migration function or trigger through swap
      // expect(tx).to.emit(hook, "CrossChainMigrationInitiated");
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw", async function () {
      const { hook, poolKey, owner } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      await expect(hook.connect(owner).emergencyWithdraw(poolId)).to.not.be.reverted;
    });

    it("Should not allow non-owner to emergency withdraw", async function () {
      const { hook, poolKey, user1 } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      await expect(
        hook.connect(user1).emergencyWithdraw(poolId)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero liquidity positions", async function () {
      const { hook, poolKey } = await loadFixture(deployFixture);

      const poolId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["tuple(address,address,uint24,int24,address)"],
          [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
        )
      );

      const liquidity = await hook.poolLiquidity(poolId);
      expect(liquidity).to.equal(0);
    });

    it("Should respect rebalance cooldown", async function () {
      const { hook, poolKey } = await loadFixture(deployFixture);

      // Multiple rapid calls should be handled by cooldown logic
      // This would be tested through multiple beforeSwap calls
    });

    it("Should handle invalid tick ranges", async function () {
      const { hook, poolKey } = await loadFixture(deployFixture);

      // Test would involve setting up conditions that could cause invalid ticks
      // and ensuring the contract handles them gracefully
    });
  });

  describe("Integration Tests", function () {
    it("Should work end-to-end with pool operations", async function () {
      const { hook, poolKey, token0, token1, user1, mockPoolManager } = await loadFixture(deployFixture);

      // This would test the full flow:
      // 1. Initialize pool
      // 2. Add liquidity
      // 3. Perform swaps
      // 4. Trigger rebalancing
      // 5. Check cross-chain opportunities
      // 6. Migrate if profitable
    });

    it("Should handle multiple pools simultaneously", async function () {
      const { hook } = await loadFixture(deployFixture);

      // Test managing multiple pool configurations and rebalancing
      // across different token pairs
    });
  });
});

// Mock contract for testing
const mockERC20 = `
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
`;

const mockPoolManager = `
pragma solidity ^0.8.24;

contract MockPoolManager {
    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint16 observationIndex;
        uint16 observationCardinality;
    }

    mapping(bytes32 => Slot0) public slot0Data;

    function setSlot0(bytes32 poolId, Slot0 memory data) external {
        slot0Data[poolId] = data;
    }

    function getSlot0(bytes32 poolId) external view returns (uint160, int24, uint16, uint16) {
        Slot0 memory data = slot0Data[poolId];
        return (data.sqrtPriceX96, data.tick, data.observationIndex, data.observationCardinality);
    }

    function modifyLiquidity(
        bytes32 poolId,
        bytes memory params,
        bytes memory hookData
    ) external returns (bytes memory) {
        // Mock implementation
        return "";
    }
}
`;

const mockAcrossIntegration = `
pragma solidity ^0.8.24;

contract MockAcrossIntegration {
    mapping(address => mapping(address => uint256)) public bestChainIds;
    mapping(address => mapping(address => uint256)) public yieldDifferences;

    function setBestYieldOpportunity(
        address token0,
        address token1,
        uint256 chainId,
        uint256 yieldDiff
    ) external {
        bestChainIds[token0][token1] = chainId;
        yieldDifferences[token0][token1] = yieldDiff;
    }

    function getBestYieldOpportunity(
        address token0,
        address token1
    ) external view returns (uint256, uint256) {
        return (bestChainIds[token0][token1], yieldDifferences[token0][token1]);
    }

    function bridgeAssets(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 destinationChainId,
        address recipient
    ) external {
        // Mock bridge implementation
    }
}
`;
