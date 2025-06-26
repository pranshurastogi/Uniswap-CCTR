// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
// import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import "./interfaces/IAcrossIntegration.sol";
import "./libraries/CrossChainUtils.sol";

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

/**
 * @title AcrossIntegration
 * @notice Integrates with Across Protocol for cross-chain asset bridging
 * @dev Handles yield monitoring and asset transfers across supported chains
 */
contract AcrossIntegration is IAcrossIntegration, Ownable, MinimalReentrancyGuard {
    using SafeERC20 for IERC20;
    using CrossChainUtils for bytes;

    // Across SpokePool interface
    interface ISpokePool {
        function deposit(
            address recipient,
            address originToken,
            uint256 amount,
            uint256 destinationChainId,
            uint64 relayerFeePct,
            uint32 quoteTimestamp,
            bytes memory message,
            uint256 maxCount
        ) external payable;

        function relayerFee(
            address token,
            uint256 amount,
            uint256 destinationChainId
        ) external view returns (uint256);

        function getFillStatus(bytes32 relayHash) external view returns (uint256);
    }

    // State variables
    mapping(uint256 => address) public spokePools;
    mapping(uint256 => mapping(address => mapping(address => YieldData))) public yieldData;
    mapping(address => bool) public authorizedUpdaters;
    mapping(uint256 => bool) public supportedChains;
    mapping(bytes32 => BridgeParams) public activeBridges;
    
    address public priceOracle;
    uint256 public defaultRelayerFeePct = 25; // 0.25%
    uint256 public maxBridgeAmount = 1000000e18; // $1M max
    uint256 public minBridgeAmount = 100e18; // $100 min
    bool public bridgingPaused;

    modifier onlyAuthorizedUpdater() {
        require(authorizedUpdaters[msg.sender] || msg.sender == owner(), "Not authorized updater");
        _;
    }

    modifier whenBridgingNotPaused() {
        require(!bridgingPaused, "Bridging is paused");
        _;
    }

    constructor(
        address _spokePool,
        address _priceOracle,
        address _owner
    ) {
        spokePools[block.chainid] = _spokePool;
        priceOracle = _priceOracle;
        _transferOwnership(_owner);
        authorizedUpdaters[_owner] = true;
        supportedChains[block.chainid] = true;
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function getBestYieldOpportunity(
        address token0,
        address token1
    ) external view override returns (uint256 bestChainId, uint256 yieldDifference) {
        uint256 currentChainYield = yieldData[block.chainid][token0][token1].apy;
        uint256 bestYield = currentChainYield;
        bestChainId = block.chainid;

        // Check all supported chains for better yield
        uint256[] memory chains = _getSupportedChainsList();
        for (uint256 i = 0; i < chains.length; i++) {
            uint256 chainId = chains[i];
            YieldData memory data = yieldData[chainId][token0][token1];
            
            if (data.timestamp > 0 && data.apy > bestYield) {
                bestYield = data.apy;
                bestChainId = chainId;
            }
        }

        yieldDifference = bestYield > currentChainYield ? bestYield - currentChainYield : 0;
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function bridgeAssets(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 destinationChainId,
        address recipient
    ) external override nonReentrant whenBridgingNotPaused {
        require(supportedChains[destinationChainId], "Destination chain not supported");
        require(spokePools[destinationChainId] != address(0), "No spoke pool for destination");
        require(recipient != address(0), "Invalid recipient");

        // Validate bridge amounts
        uint256 totalValue = _calculateTotalValue(token0, token1, amount0, amount1);
        require(totalValue >= minBridgeAmount, "Amount below minimum");
        require(totalValue <= maxBridgeAmount, "Amount exceeds maximum");

        // Bridge each token if amount > 0
        bytes32 bridgeId = keccak256(abi.encodePacked(
            msg.sender,
            token0,
            token1,
            amount0,
            amount1,
            destinationChainId,
            block.timestamp
        ));

        BridgeParams memory params = BridgeParams({
            token0: token0,
            token1: token1,
            amount0: amount0,
            amount1: amount1,
            destinationChainId: destinationChainId,
            recipient: recipient,
            relayerFeePct: uint32(defaultRelayerFeePct),
            quoteTimestamp: uint32(block.timestamp),
            message: abi.encode(bridgeId, msg.sender)
        });

        activeBridges[bridgeId] = params;

        uint256 totalCost = 0;

        if (amount0 > 0) {
            totalCost += _bridgeToken(token0, amount0, destinationChainId, recipient, params);
        }

        if (amount1 > 0) {
            totalCost += _bridgeToken(token1, amount1, destinationChainId, recipient, params);
        }

        emit BridgeInitiated(
            token0,
            token1,
            amount0,
            amount1,
            destinationChainId,
            recipient,
            totalCost
        );
    }

    /**
     * @notice Bridges a single token via Across Protocol
     * @param token Token address to bridge
     * @param amount Amount to bridge
     * @param destinationChainId Destination chain ID
     * @param recipient Recipient address
     * @param params Bridge parameters
     * @return bridgeCost Cost of the bridge operation
     */
    function _bridgeToken(
        address token,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        BridgeParams memory params
    ) internal returns (uint256 bridgeCost) {
        ISpokePool spokePool = ISpokePool(spokePools[block.chainid]);
        
        // Transfer tokens from caller
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        // Approve spoke pool
        IERC20(token).safeApprove(address(spokePool), amount);
        
        // Calculate relayer fee
        bridgeCost = spokePool.relayerFee(token, amount, destinationChainId);
        
        // Perform deposit
        spokePool.deposit(
            recipient,
            token,
            amount,
            destinationChainId,
            params.relayerFeePct,
            params.quoteTimestamp,
            params.message,
            type(uint256).max
        );
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function getChainYieldData(
        uint256 chainId,
        address token0,
        address token1
    ) external view override returns (YieldData memory) {
        return yieldData[chainId][token0][token1];
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function estimateBridgingCost(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 destinationChainId
    ) external view override returns (uint256 bridgingCost) {
        require(spokePools[block.chainid] != address(0), "No spoke pool available");
        
        ISpokePool spokePool = ISpokePool(spokePools[block.chainid]);
        
        if (amount0 > 0) {
            bridgingCost += spokePool.relayerFee(token0, amount0, destinationChainId);
        }
        
        if (amount1 > 0) {
            bridgingCost += spokePool.relayerFee(token1, amount1, destinationChainId);
        }
        
        // Add estimated gas costs for destination chain
        YieldData memory destChainData = yieldData[destinationChainId][token0][token1];
        if (destChainData.gasPrice > 0) {
            uint256 estimatedGas = CrossChainUtils.estimateGasCost(
                destinationChainId,
                destChainData.gasPrice,
                3 // Medium complexity
            );
            bridgingCost += estimatedGas;
        }
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function isMigrationProfitable(
        uint256 currentChainId,
        uint256 targetChainId,
        address token0,
        address token1,
        uint256 totalValue
    ) external view override returns (bool isProfitable, uint256 profitEstimate) {
        YieldData memory currentData = yieldData[currentChainId][token0][token1];
        YieldData memory targetData = yieldData[targetChainId][token0][token1];
        
        if (currentData.timestamp == 0 || targetData.timestamp == 0) {
            return (false, 0);
        }
        
        if (targetData.apy <= currentData.apy) {
            return (false, 0);
        }
        
        uint256 yieldDifference = targetData.apy - currentData.apy;
        
        // Calculate 30-day profit estimate
        profitEstimate = (totalValue * yieldDifference * 30) / (365 * 10000);
        
        // Calculate migration cost
        uint256 migrationCost = this.estimateBridgingCost(
            token0,
            token1,
            totalValue / 2,
            totalValue / 2,
            targetChainId
        );
        
        // Profitable if 30-day additional yield > migration cost + 10% buffer
        isProfitable = profitEstimate > (migrationCost * 11) / 10;
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function getSupportedChains(
        address token0,
        address token1
    ) external view override returns (uint256[] memory chainIds) {
        uint256[] memory allChains = _getSupportedChainsList();
        uint256 validCount = 0;
        
        // Count chains with valid data for this token pair
        for (uint256 i = 0; i < allChains.length; i++) {
            if (yieldData[allChains[i]][token0][token1].timestamp > 0) {
                validCount++;
            }
        }
        
        // Create result array
        chainIds = new uint256[](validCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allChains.length; i++) {
            if (yieldData[allChains[i]][token0][token1].timestamp > 0) {
                chainIds[index] = allChains[i];
                index++;
            }
        }
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function updateYieldData(
        uint256 chainId,
        address token0,
        address token1,
        uint256 apy,
        uint256 tvl,
        uint256 gasPrice
    ) external override onlyAuthorizedUpdater {
        require(supportedChains[chainId], "Chain not supported");
        
        yieldData[chainId][token0][token1] = YieldData({
            chainId: chainId,
            apy: apy,
            tvl: tvl,
            gasPrice: gasPrice,
            timestamp: block.timestamp
        });

        emit YieldDataUpdated(chainId, token0, token1, apy, tvl, gasPrice);
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function pauseBridging() external override onlyOwner {
        bridgingPaused = true;
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function unpauseBridging() external override onlyOwner {
        bridgingPaused = false;
    }

    /**
     * @inheritdoc IAcrossIntegration
     */
    function isBridgingPaused() external view override returns (bool) {
        return bridgingPaused;
    }

    /**
     * @notice Calculates total value of token amounts in USD
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
        // This would integrate with a price oracle like Chainlink
        // For now, simplified calculation assuming $1 per token
        totalValue = amount0 + amount1;
    }

    /**
     * @notice Gets list of all supported chain IDs
     * @return chains Array of supported chain IDs
     */
    function _getSupportedChainsList() internal view returns (uint256[] memory chains) {
        // In a real implementation, this would maintain a dynamic list
        // For now, return common chains
        chains = new uint256[](5);
        chains[0] = 1;      // Ethereum
        chains[1] = 137;    // Polygon
        chains[2] = 42161;  // Arbitrum
        chains[3] = 10;     // Optimism
        chains[4] = 8453;   // Base
    }

    // Admin functions
    function setSpokePool(uint256 chainId, address spokePool) external onlyOwner {
        spokePools[chainId] = spokePool;
        supportedChains[chainId] = spokePool != address(0);
    }

    function setAuthorizedUpdater(address updater, bool authorized) external onlyOwner {
        authorizedUpdaters[updater] = authorized;
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        priceOracle = _priceOracle;
    }

    function setDefaultRelayerFeePct(uint256 _relayerFeePct) external onlyOwner {
        require(_relayerFeePct <= 1000, "Fee too high"); // Max 10%
        defaultRelayerFeePct = _relayerFeePct;
    }

    function setBridgeLimits(uint256 _minAmount, uint256 _maxAmount) external onlyOwner {
        require(_minAmount < _maxAmount, "Invalid limits");
        minBridgeAmount = _minAmount;
        maxBridgeAmount = _maxAmount;
    }

    function setSupportedChain(uint256 chainId, bool supported) external onlyOwner {
        supportedChains[chainId] = supported;
    }

    // Emergency functions
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    function emergencyWithdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // View functions
    function getBridgeParams(bytes32 bridgeId) external view returns (BridgeParams memory) {
        return activeBridges[bridgeId];
    }

    function getYieldComparison(
        address token0,
        address token1
    ) external view returns (uint256[] memory chainIds, uint256[] memory apys) {
        uint256[] memory allChains = _getSupportedChainsList();
        chainIds = new uint256[](allChains.length);
        apys = new uint256[](allChains.length);
        
        for (uint256 i = 0; i < allChains.length; i++) {
            chainIds[i] = allChains[i];
            apys[i] = yieldData[allChains[i]][token0][token1].apy;
        }
    }

    // Receive ETH for gas payments
    receive() external payable {}
} 