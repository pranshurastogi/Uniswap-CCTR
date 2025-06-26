// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IAcrossIntegration.sol";
import "./libraries/CrossChainUtils.sol";
import {BaseHook} from "../uniswap/v4/BaseHook.sol";

// Minimal ReentrancyGuard
contract MinimalReentrancyGuard {
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// Minimal Pausable
contract MinimalPausable {
    event Paused(address account);
    event Unpaused(address account);

    bool private _paused;

    constructor() {
        _paused = false;
    }

    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    modifier whenPaused() {
        require(_paused, "Pausable: not paused");
        _;
    }

    function paused() public view returns (bool) {
        return _paused;
    }

    function _pause() internal virtual whenNotPaused {
        _paused = true;
        emit Paused(msg.sender);
    }

    function _unpause() internal virtual whenPaused {
        _paused = false;
        emit Unpaused(msg.sender);
    }
}

/**
 * @title CrossChainRebalancer
 * @notice Orchestrates cross-chain liquidity migrations for optimal yield
 * @dev Integrates with Across Protocol for secure bridging
 */
contract CrossChainRebalancer is Ownable, MinimalReentrancyGuard, MinimalPausable {
    using SafeERC20 for IERC20;
    using CrossChainUtils for bytes;

    // Events
    event MigrationInitiated(
        uint256 indexed fromChain,
        uint256 indexed toChain,
        address indexed user,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes32 migrationId
    );

    event MigrationCompleted(
        bytes32 indexed migrationId,
        uint256 indexed toChain,
        address indexed user,
        uint256 finalAmount0,
        uint256 finalAmount1
    );

    event YieldOpportunityDetected(
        uint256 indexed chainId,
        address indexed token0,
        address indexed token1,
        uint256 yieldDifference,
        uint256 migrationCost
    );

    // Structs
    struct Migration {
        address user;
        uint256 fromChain;
        uint256 toChain;
        address token0;
        address token1;
        uint256 amount0;
        uint256 amount1;
        uint256 timestamp;
        MigrationStatus status;
        uint256 estimatedCost;
        uint256 expectedYield;
    }

    struct ChainMetrics {
        uint256 tvl;
        uint256 apy;
        uint256 gasPrice;
        uint256 lastUpdate;
        bool isActive;
    }

    enum MigrationStatus {
        Pending,
        InProgress,
        Completed,
        Failed,
        Cancelled
    }

    // State variables
    IAcrossIntegration public acrossIntegration;
    mapping(bytes32 => Migration) public migrations;
    mapping(uint256 => mapping(address => mapping(address => ChainMetrics))) public chainMetrics;
    mapping(uint256 => bool) public supportedChains;
    mapping(address => bool) public authorizedCallers;
    
    uint256 public migrationCounter;
    uint256 public constant YIELD_THRESHOLD = 100; // 1% minimum yield difference
    uint256 public constant MIN_MIGRATION_AMOUNT = 1000e18; // $1000 minimum
    uint256 public constant MAX_SLIPPAGE = 500; // 5% max slippage
    
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    constructor(
        address _acrossIntegration,
        address _owner
    ) {
        acrossIntegration = IAcrossIntegration(_acrossIntegration);
        _transferOwnership(_owner);
        authorizedCallers[_owner] = true;
    }

    /**
     * @notice Initiates cross-chain migration for better yield
     * @param token0 First token address
     * @param token1 Second token address
     * @param amount0 Amount of first token
     * @param amount1 Amount of second token
     * @param targetChain Destination chain ID
     * @return migrationId Unique migration identifier
     */
    function initiateMigration(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 targetChain
    ) external nonReentrant whenNotPaused returns (bytes32 migrationId) {
        require(supportedChains[targetChain], "Target chain not supported");
        require(amount0 > 0 || amount1 > 0, "Invalid amounts");
        
        // Calculate total value in USD
        uint256 totalValue = _calculateTotalValue(token0, token1, amount0, amount1);
        require(totalValue >= MIN_MIGRATION_AMOUNT, "Amount below minimum");

        // Check if migration is profitable
        (bool isProfitable, uint256 expectedYield, uint256 estimatedCost) = _evaluateMigration(
            block.chainid,
            targetChain,
            token0,
            token1,
            totalValue
        );
        require(isProfitable, "Migration not profitable");

        // Generate migration ID
        migrationId = keccak256(abi.encodePacked(
            msg.sender,
            block.chainid,
            targetChain,
            token0,
            token1,
            amount0,
            amount1,
            block.timestamp,
            migrationCounter++
        ));

        // Store migration data
        migrations[migrationId] = Migration({
            user: msg.sender,
            fromChain: block.chainid,
            toChain: targetChain,
            token0: token0,
            token1: token1,
            amount0: amount0,
            amount1: amount1,
            timestamp: block.timestamp,
            status: MigrationStatus.Pending,
            estimatedCost: estimatedCost,
            expectedYield: expectedYield
        });

        // Transfer tokens from user
        if (amount0 > 0) {
            IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        }
        if (amount1 > 0) {
            IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        }

        emit MigrationInitiated(
            block.chainid,
            targetChain,
            msg.sender,
            token0,
            token1,
            amount0,
            amount1,
            migrationId
        );

        // Execute migration
        _executeMigration(migrationId);

        return migrationId;
    }

    /**
     * @notice Executes the cross-chain migration via Across Protocol
     * @param migrationId Migration identifier
     */
    function _executeMigration(bytes32 migrationId) internal {
        Migration storage migration = migrations[migrationId];
        require(migration.status == MigrationStatus.Pending, "Invalid migration status");

        migration.status = MigrationStatus.InProgress;

        // Approve tokens for Across integration
        if (migration.amount0 > 0) {
            IERC20(migration.token0).safeApprove(address(acrossIntegration), migration.amount0);
        }
        if (migration.amount1 > 0) {
            IERC20(migration.token1).safeApprove(address(acrossIntegration), migration.amount1);
        }

        // Bridge assets via Across
        try acrossIntegration.bridgeAssets(
            migration.token0,
            migration.token1,
            migration.amount0,
            migration.amount1,
            migration.toChain,
            migration.user
        ) {
            // Migration initiated successfully
            // Status will be updated when bridge completes
        } catch Error(string memory reason) {
            migration.status = MigrationStatus.Failed;
            _refundUser(migrationId, reason);
        }
    }

    /**
     * @notice Called when bridge transaction completes on destination chain
     * @param migrationId Migration identifier
     * @param finalAmount0 Final amount of token0 received
     * @param finalAmount1 Final amount of token1 received
     */
    function completeMigration(
        bytes32 migrationId,
        uint256 finalAmount0,
        uint256 finalAmount1
    ) external onlyAuthorized {
        Migration storage migration = migrations[migrationId];
        require(migration.status == MigrationStatus.InProgress, "Invalid migration status");

        migration.status = MigrationStatus.Completed;

        emit MigrationCompleted(
            migrationId,
            migration.toChain,
            migration.user,
            finalAmount0,
            finalAmount1
        );
    }

    /**
     * @notice Evaluates if migration is profitable
     * @param fromChain Source chain ID
     * @param toChain Target chain ID
     * @param token0 First token address
     * @param token1 Second token address
     * @param totalValue Total position value in USD
     * @return isProfitable Whether migration is profitable
     * @return expectedYield Expected additional yield over 30 days
     * @return estimatedCost Total migration cost
     */
    function _evaluateMigration(
        uint256 fromChain,
        uint256 toChain,
        address token0,
        address token1,
        uint256 totalValue
    ) internal view returns (bool isProfitable, uint256 expectedYield, uint256 estimatedCost) {
        // Get current chain metrics
        ChainMetrics memory fromMetrics = chainMetrics[fromChain][token0][token1];
        ChainMetrics memory toMetrics = chainMetrics[toChain][token0][token1];

        require(fromMetrics.isActive && toMetrics.isActive, "Chain metrics unavailable");

        // Calculate yield difference (30 days)
        uint256 yieldDifference = toMetrics.apy > fromMetrics.apy ? 
            toMetrics.apy - fromMetrics.apy : 0;
        
        expectedYield = (totalValue * yieldDifference * 30) / (365 * 10000); // 30-day yield

        // Calculate migration costs
        estimatedCost = acrossIntegration.estimateBridgingCost(
            token0,
            token1,
            totalValue / 2, // Approximate split
            totalValue / 2,
            toChain
        );

        // Add gas costs
        uint256 gasCost = (toMetrics.gasPrice * 300000) / 1e9; // Estimated gas in ETH
        estimatedCost += gasCost;

        // Check profitability
        isProfitable = expectedYield > estimatedCost && 
                      yieldDifference >= YIELD_THRESHOLD;
    }

    /**
     * @notice Calculates total position value in USD
     * @param token0 First token address
     * @param token1 Second token address
     * @param amount0 Amount of first token
     * @param amount1 Amount of second token
     * @return totalValue Total value in USD (18 decimals)
     */
    function _calculateTotalValue(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) internal view returns (uint256 totalValue) {
        // This would integrate with price oracles like Chainlink
        // For now, simplified calculation
        totalValue = amount0 + amount1; // Assuming 1:1 USD value for demo
    }

    /**
     * @notice Refunds user in case of failed migration
     * @param migrationId Migration identifier
     * @param reason Failure reason
     */
    function _refundUser(bytes32 migrationId, string memory reason) internal {
        Migration storage migration = migrations[migrationId];
        
        if (migration.amount0 > 0) {
            IERC20(migration.token0).safeTransfer(migration.user, migration.amount0);
        }
        if (migration.amount1 > 0) {
            IERC20(migration.token1).safeTransfer(migration.user, migration.amount1);
        }

        // Emit refund event (could add custom event)
    }

    /**
     * @notice Updates chain metrics for yield calculations
     * @param chainId Chain ID
     * @param token0 First token address
     * @param token1 Second token address
     * @param tvl Total value locked
     * @param apy Annual percentage yield (basis points)
     * @param gasPrice Average gas price
     */
    function updateChainMetrics(
        uint256 chainId,
        address token0,
        address token1,
        uint256 tvl,
        uint256 apy,
        uint256 gasPrice
    ) external onlyAuthorized {
        chainMetrics[chainId][token0][token1] = ChainMetrics({
            tvl: tvl,
            apy: apy,
            gasPrice: gasPrice,
            lastUpdate: block.timestamp,
            isActive: true
        });

        // Check for yield opportunities
        _checkYieldOpportunity(chainId, token0, token1, apy);
    }

    /**
     * @notice Checks for yield opportunities across chains
     * @param chainId Updated chain ID
     * @param token0 First token address
     * @param token1 Second token address
     * @param newApy New APY for the chain
     */
    function _checkYieldOpportunity(
        uint256 chainId,
        address token0,
        address token1,
        uint256 newApy
    ) internal {
        // Compare with current chain yield
        ChainMetrics memory currentMetrics = chainMetrics[block.chainid][token0][token1];
        
        if (currentMetrics.isActive && newApy > currentMetrics.apy + YIELD_THRESHOLD) {
            uint256 yieldDifference = newApy - currentMetrics.apy;
            uint256 migrationCost = 0; // Would calculate actual cost
            
            emit YieldOpportunityDetected(
                chainId,
                token0,
                token1,
                yieldDifference,
                migrationCost
            );
        }
    }

    // Admin functions
    function setSupportedChain(uint256 chainId, bool supported) external onlyOwner {
        supportedChains[chainId] = supported;
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setAcrossIntegration(address _acrossIntegration) external onlyOwner {
        acrossIntegration = IAcrossIntegration(_acrossIntegration);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // View functions
    function getMigration(bytes32 migrationId) external view returns (Migration memory) {
        return migrations[migrationId];
    }

    function getChainMetrics(
        uint256 chainId,
        address token0,
        address token1
    ) external view returns (ChainMetrics memory) {
        return chainMetrics[chainId][token0][token1];
    }

    function estimateMigrationProfitability(
        uint256 targetChain,
        address token0,
        address token1,
        uint256 totalValue
    ) external view returns (bool isProfitable, uint256 expectedYield, uint256 estimatedCost) {
        return _evaluateMigration(block.chainid, targetChain, token0, token1, totalValue);
    }
}
