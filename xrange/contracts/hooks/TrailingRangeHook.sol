// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-core/contracts/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/contracts/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/contracts/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/contracts/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/contracts/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/contracts/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/contracts/types/BeforeSwapDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/contracts/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IAcrossIntegration.sol";
import "../libraries/PositionMath.sol";

contract TrailingRangeHook is BaseHook, Ownable {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // Events
    event PositionRebalanced(
        PoolId indexed poolId,
        int24 newLowerTick,
        int24 newUpperTick,
        uint128 liquidity
    );
    
    event CrossChainMigrationInitiated(
        PoolId indexed poolId,
        uint256 destinationChainId,
        uint256 amount0,
        uint256 amount1
    );

    // Configuration struct
    struct PoolConfig {
        uint24 rebalanceThreshold; // basis points from center
        uint24 rangeWidth; // tick range width
        uint256 minLiquidity; // minimum liquidity to maintain
        bool crossChainEnabled;
        uint256 lastRebalanceBlock;
        int24 currentLowerTick;
        int24 currentUpperTick;
    }

    // Cross-chain configuration
    struct CrossChainConfig {
        uint256 chainId;
        address spokePool;
        uint256 gasThreshold; // max gas price for operations
        uint256 yieldThreshold; // minimum yield difference to migrate
    }

    // State variables
    mapping(PoolId => PoolConfig) public poolConfigs;
    mapping(uint256 => CrossChainConfig) public crossChainConfigs;
    mapping(PoolId => uint256) public poolLiquidity;
    
    IAcrossIntegration public acrossIntegration;
    
    // Constants
    uint24 private constant REBALANCE_THRESHOLD = 100; // 1%
    uint24 private constant DEFAULT_RANGE_WIDTH = 60; // 60 ticks
    uint256 private constant REBALANCE_COOLDOWN = 10; // blocks

    constructor(
        IPoolManager _poolManager,
        address _acrossIntegration
    ) BaseHook(_poolManager) {
        acrossIntegration = IAcrossIntegration(_acrossIntegration);
        _transferOwnership(msg.sender);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // Initialize pool configuration after pool creation
    function afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24 tick,
        bytes calldata
    ) external override returns (bytes4) {
        PoolId poolId = key.toId();
        
        poolConfigs[poolId] = PoolConfig({
            rebalanceThreshold: REBALANCE_THRESHOLD,
            rangeWidth: DEFAULT_RANGE_WIDTH,
            minLiquidity: 1e18,
            crossChainEnabled: true,
            lastRebalanceBlock: block.number,
            currentLowerTick: tick - int24(DEFAULT_RANGE_WIDTH),
            currentUpperTick: tick + int24(DEFAULT_RANGE_WIDTH)
        });

        return BaseHook.afterInitialize.selector;
    }

    // Check liquidity bounds before adding
    function beforeAddLiquidity(
        address,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external override returns (bytes4) {
        PoolId poolId = key.toId();
        PoolConfig storage config = poolConfigs[poolId];
        
        // Ensure liquidity is added within our managed range
        require(
            params.tickLower >= config.currentLowerTick &&
            params.tickUpper <= config.currentUpperTick,
            "Liquidity outside managed range"
        );

        return BaseHook.beforeAddLiquidity.selector;
    }

    // Main rebalancing logic triggered on swaps
    function beforeSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        bytes calldata
    ) external override returns (bytes4, BeforeSwapDelta, uint24) {
        _checkAndRebalance(key);
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external override returns (bytes4, int128) {
        _monitorCrossChainOpportunities(key);
        return (BaseHook.afterSwap.selector, 0);
    }

    // Core rebalancing function
    function _checkAndRebalance(PoolKey calldata key) internal {
        PoolId poolId = key.toId();
        PoolConfig storage config = poolConfigs[poolId];
        
        // Cooldown check
        if (block.number - config.lastRebalanceBlock < REBALANCE_COOLDOWN) {
            return;
        }

        // Get current pool state
        (uint160 sqrtPriceX96, int24 currentTick,,) = poolManager.getSlot0(poolId);
        
        // Calculate if rebalancing is needed
        int24 tickDistance = _getTickDistance(currentTick, config.currentLowerTick, config.currentUpperTick);
        
        if (uint24(tickDistance) > config.rebalanceThreshold) {
            _executeRebalance(key, currentTick, config);
        }
    }

    function _executeRebalance(
        PoolKey calldata key,
        int24 currentTick,
        PoolConfig storage config
    ) internal {
        PoolId poolId = key.toId();
        
        // Calculate new range centered around current tick
        int24 newLowerTick = currentTick - int24(config.rangeWidth / 2);
        int24 newUpperTick = currentTick + int24(config.rangeWidth / 2);
        
        // Align to tick spacing
        newLowerTick = PositionMath.alignToTickSpacing(newLowerTick, key.fee);
        newUpperTick = PositionMath.alignToTickSpacing(newUpperTick, key.fee);

        // Remove old liquidity
        if (poolLiquidity[poolId] > 0) {
            IPoolManager.ModifyLiquidityParams memory removeParams = IPoolManager.ModifyLiquidityParams({
                tickLower: config.currentLowerTick,
                tickUpper: config.currentUpperTick,
                liquidityDelta: -int256(uint256(poolLiquidity[poolId])),
                salt: bytes32(0)
            });
            
            poolManager.modifyLiquidity(key, removeParams, "");
        }

        // Calculate new liquidity amount
        uint128 newLiquidity = _calculateOptimalLiquidity(key, newLowerTick, newUpperTick);
        
        // Add new liquidity
        if (newLiquidity > 0) {
            IPoolManager.ModifyLiquidityParams memory addParams = IPoolManager.ModifyLiquidityParams({
                tickLower: newLowerTick,
                tickUpper: newUpperTick,
                liquidityDelta: int256(uint256(newLiquidity)),
                salt: bytes32(0)
            });
            
            poolManager.modifyLiquidity(key, addParams, "");
            poolLiquidity[poolId] = newLiquidity;
        }

        // Update configuration
        config.currentLowerTick = newLowerTick;
        config.currentUpperTick = newUpperTick;
        config.lastRebalanceBlock = block.number;

        emit PositionRebalanced(poolId, newLowerTick, newUpperTick, newLiquidity);
    }

    function _monitorCrossChainOpportunities(PoolKey calldata key) internal {
        PoolId poolId = key.toId();
        PoolConfig storage config = poolConfigs[poolId];
        
        if (!config.crossChainEnabled) return;

        // Check cross-chain yield opportunities
        (uint256 bestChainId, uint256 yieldDifference) = acrossIntegration.getBestYieldOpportunity(
            address(key.currency0),
            address(key.currency1)
        );

        if (bestChainId != block.chainid && yieldDifference > crossChainConfigs[bestChainId].yieldThreshold) {
            _initiateCrossChainMigration(key, bestChainId);
        }
    }

    function _initiateCrossChainMigration(PoolKey calldata key, uint256 destinationChainId) internal {
        PoolId poolId = key.toId();
        uint128 liquidity = poolLiquidity[poolId];
        
        if (liquidity == 0) return;

        // Remove all liquidity
        IPoolManager.ModifyLiquidityParams memory removeParams = IPoolManager.ModifyLiquidityParams({
            tickLower: poolConfigs[poolId].currentLowerTick,
            tickUpper: poolConfigs[poolId].currentUpperTick,
            liquidityDelta: -int256(uint256(liquidity)),
            salt: bytes32(0)
        });
        
        BalanceDelta delta = poolManager.modifyLiquidity(key, removeParams, "");
        
        uint256 amount0 = uint256(uint128(delta.amount0()));
        uint256 amount1 = uint256(uint128(delta.amount1()));

        // Bridge assets via Across
        acrossIntegration.bridgeAssets(
            address(key.currency0),
            address(key.currency1),
            amount0,
            amount1,
            destinationChainId,
            address(this)
        );

        poolLiquidity[poolId] = 0;
        
        emit CrossChainMigrationInitiated(poolId, destinationChainId, amount0, amount1);
    }

    // Utility functions
    function _getTickDistance(int24 currentTick, int24 lowerTick, int24 upperTick) internal pure returns (int24) {
        int24 center = (lowerTick + upperTick) / 2;
        return currentTick > center ? currentTick - center : center - currentTick;
    }

    function _calculateOptimalLiquidity(
        PoolKey calldata key,
        int24 lowerTick,
        int24 upperTick
    ) internal view returns (uint128) {
        // Simplified liquidity calculation
        // In production, this should consider available token balances,
        // optimal capital allocation, and slippage protection
        
        uint256 balance0 = key.currency0.balanceOfSelf();
        uint256 balance1 = key.currency1.balanceOfSelf();
        
        return PositionMath.calculateLiquidityFromBalances(
            balance0,
            balance1,
            lowerTick,
            upperTick
        );
    }

    // Admin functions
    function setPoolConfig(
        PoolId poolId,
        uint24 rebalanceThreshold,
        uint24 rangeWidth,
        bool crossChainEnabled
    ) external onlyOwner {
        PoolConfig storage config = poolConfigs[poolId];
        config.rebalanceThreshold = rebalanceThreshold;
        config.rangeWidth = rangeWidth;
        config.crossChainEnabled = crossChainEnabled;
    }

    function setCrossChainConfig(
        uint256 chainId,
        address spokePool,
        uint256 gasThreshold,
        uint256 yieldThreshold
    ) external onlyOwner {
        crossChainConfigs[chainId] = CrossChainConfig({
            chainId: chainId,
            spokePool: spokePool,
            gasThreshold: gasThreshold,
            yieldThreshold: yieldThreshold
        });
    }

    function emergencyWithdraw(PoolId poolId) external onlyOwner {
        // Emergency function to withdraw all liquidity
        uint128 liquidity = poolLiquidity[poolId];
        if (liquidity > 0) {
            // Implementation would remove liquidity and transfer tokens to owner
        }
    }
}