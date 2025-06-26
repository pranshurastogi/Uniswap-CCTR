// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolId} from "@uniswap/v4-core/contracts/types/PoolId.sol";

/**
 * @title ITrailingRangeHook
 * @notice Interface for the TrailingRangeHook contract
 * @dev Defines the external functions for managing trailing range positions
 */
interface ITrailingRangeHook {
    // Events
    event PositionRebalanced(
        PoolId indexed poolId,
        int24 newLowerTick,
        int24 newUpperTick,
        uint128 liquidity,
        address indexed user
    );
    
    event CrossChainMigrationInitiated(
        PoolId indexed poolId,
        uint256 destinationChainId,
        uint256 amount0,
        uint256 amount1,
        address indexed user
    );

    event PoolConfigUpdated(
        PoolId indexed poolId,
        uint24 rebalanceThreshold,
        uint24 rangeWidth,
        bool crossChainEnabled
    );

    event EmergencyPause(
        PoolId indexed poolId,
        bool paused,
        string reason
    );

    // Structs
    struct PoolConfig {
        uint24 rebalanceThreshold; // basis points from center
        uint24 rangeWidth; // tick range width
        uint256 minLiquidity; // minimum liquidity to maintain
        bool crossChainEnabled;
        uint256 lastRebalanceBlock;
        int24 currentLowerTick;
        int24 currentUpperTick;
        bool isActive;
        address manager; // authorized manager for this pool
    }

    struct RebalanceParams {
        PoolId poolId;
        int24 newLowerTick;
        int24 newUpperTick;
        uint128 liquidityDelta;
        bool forceRebalance;
        uint256 maxSlippage;
    }

    struct CrossChainParams {
        uint256 chainId;
        address spokePool;
        uint256 gasThreshold; // max gas price for operations
        uint256 yieldThreshold; // minimum yield difference to migrate
        bool isActive;
    }

    // Pool configuration functions
    function setPoolConfig(
        PoolId poolId,
        uint24 rebalanceThreshold,
        uint24 rangeWidth,
        bool crossChainEnabled
    ) external;

    function setCrossChainConfig(
        uint256 chainId,
        address spokePool,
        uint256 gasThreshold,
        uint256 yieldThreshold
    ) external;

    function setPoolManager(PoolId poolId, address manager) external;

    // Core functionality
    function manualRebalance(RebalanceParams calldata params) external;

    function initiateCrossChainMigration(
        PoolId poolId,
        uint256 destinationChainId
    ) external returns (bytes32 migrationId);

    function emergencyPause(PoolId poolId, string calldata reason) external;

    function emergencyUnpause(PoolId poolId) external;

    function emergencyWithdraw(PoolId poolId) external;

    // View functions
    function getPoolConfig(PoolId poolId) external view returns (PoolConfig memory);

    function getCrossChainConfig(uint256 chainId) external view returns (CrossChainParams memory);

    function getPoolLiquidity(PoolId poolId) external view returns (uint128);

    function isRebalanceNeeded(PoolId poolId) external view returns (bool needed, int24 currentTick);

    function estimateRebalanceCost(PoolId poolId) external view returns (uint256 gasCost);

    function getPositionStatus(PoolId poolId) external view returns (
        int24 lowerTick,
        int24 upperTick,
        uint128 liquidity,
        uint256 token0Balance,
        uint256 token1Balance,
        bool isInRange
    );

    function calculateOptimalRange(
        PoolId poolId,
        int24 currentTick
    ) external view returns (int24 lowerTick, int24 upperTick);

    function getCrossChainOpportunity(
        PoolId poolId
    ) external view returns (
        uint256 bestChainId,
        uint256 yieldDifference,
        uint256 migrationCost,
        bool isProfitable
    );

    // Yield and analytics functions
    function getPositionMetrics(PoolId poolId) external view returns (
        uint256 feesEarned,
        uint256 impermanentLoss,
        uint256 totalReturn,
        uint256 apy
    );

    function getRebalanceHistory(PoolId poolId) external view returns (
        uint256[] memory timestamps,
        int24[] memory lowerTicks,
        int24[] memory upperTicks,
        uint128[] memory liquidityAmounts
    );

    // Admin functions
    function setRebalanceCooldown(uint256 _cooldown) external;

    function setMinLiquidityThreshold(uint256 _threshold) external;

    function setMaxSlippage(uint256 _slippage) external;

    function addAuthorizedManager(address manager) external;

    function removeAuthorizedManager(address manager) external;

    function updateAcrossIntegration(address _acrossIntegration) external;

    // Emergency and maintenance
    function pause() external;

    function unpause() external;

    function isPaused() external view returns (bool);

    function isPoolPaused(PoolId poolId) external view returns (bool);

    function getContractVersion() external pure returns (string memory);

    function getLastUpdateTimestamp(PoolId poolId) external view returns (uint256);

    // Fee collection
    function collectFees(PoolId poolId) external returns (uint256 amount0, uint256 amount1);

    function claimableFees(PoolId poolId) external view returns (uint256 amount0, uint256 amount1);

    function setFeeRecipient(address recipient) external;

    function getFeeRecipient() external view returns (address);
}
