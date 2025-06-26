// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAcrossIntegration {
    struct YieldData {
        uint256 chainId;
        uint256 apy; // Annual percentage yield in basis points
        uint256 tvl; // Total value locked
        uint256 gasPrice; // Average gas price on the chain
        uint256 timestamp; // Last update timestamp
    }
    
    struct BridgeParams {
        address token0;
        address token1;
        uint256 amount0;
        uint256 amount1;
        uint256 destinationChainId;
        address recipient;
        uint32 relayerFeePct; // Relayer fee percentage
        uint32 quoteTimestamp; // Quote timestamp
        bytes message; // Optional message for the destination
    }
    
    /// @notice Gets the best yield opportunity across supported chains
    /// @param token0 First token address
    /// @param token1 Second token address  
    /// @return bestChainId Chain ID with highest yield
    /// @return yieldDifference Yield difference in basis points
    function getBestYieldOpportunity(
        address token0,
        address token1
    ) external view returns (uint256 bestChainId, uint256 yieldDifference);
    
    /// @notice Bridges assets to another chain via Across Protocol
    /// @param token0 First token to bridge
    /// @param token1 Second token to bridge
    /// @param amount0 Amount of first token
    /// @param amount1 Amount of second token
    /// @param destinationChainId Target chain ID
    /// @param recipient Recipient address on destination chain
    function bridgeAssets(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 destinationChainId,
        address recipient
    ) external;
    
    /// @notice Gets current yield data for a specific chain and token pair
    /// @param chainId Target chain ID
    /// @param token0 First token address
    /// @param token1 Second token address
    /// @return yieldData Current yield information
    function getChainYieldData(
        uint256 chainId,
        address token0,
        address token1
    ) external view returns (YieldData memory yieldData);
    
    /// @notice Estimates bridging cost for given parameters
    /// @param token0 First token address
    /// @param token1 Second token address
    /// @param amount0 Amount of first token
    /// @param amount1 Amount of second token
    /// @param destinationChainId Target chain ID
    /// @return bridgingCost Total cost in ETH
    function estimateBridgingCost(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 destinationChainId
    ) external view returns (uint256 bridgingCost);
    
    /// @notice Checks if a chain migration is profitable
    /// @param currentChainId Current chain ID
    /// @param targetChainId Target chain ID
    /// @param token0 First token address
    /// @param token1 Second token address
    /// @param totalValue Total position value in USD
    /// @return isProfitable Whether migration is profitable
    /// @return profitEstimate Estimated additional profit over 30 days
    function isMigrationProfitable(
        uint256 currentChainId,
        uint256 targetChainId,
        address token0,
        address token1,
        uint256 totalValue
    ) external view returns (bool isProfitable, uint256 profitEstimate);
    
    /// @notice Gets supported chains for a token pair
    /// @param token0 First token address
    /// @param token1 Second token address
    /// @return chainIds Array of supported chain IDs
    function getSupportedChains(
        address token0,
        address token1
    ) external view returns (uint256[] memory chainIds);
    
    /// @notice Updates yield data for a specific chain (called by oracles)
    /// @param chainId Chain ID to update
    /// @param token0 First token address
    /// @param token1 Second token address
    /// @param apy New APY in basis points
    /// @param tvl New TVL
    /// @param gasPrice New average gas price
    function updateYieldData(
        uint256 chainId,
        address token0,
        address token1,
        uint256 apy,
        uint256 tvl,
        uint256 gasPrice
    ) external;
    
    /// @notice Emergency pause bridging operations
    function pauseBridging() external;
    
    /// @notice Resume bridging operations
    function unpauseBridging() external;
    
    /// @notice Check if bridging is currently paused
    /// @return isPaused Current pause status
    function isBridgingPaused() external view returns (bool isPaused);
    
    /// Events
    event YieldDataUpdated(
        uint256 indexed chainId,
        address indexed token0,
        address indexed token1,
        uint256 apy,
        uint256 tvl,
        uint256 gasPrice
    );
    
    event BridgeInitiated(
        address indexed token0,
        address indexed token1,
        uint256 amount0,
        uint256 amount1,
        uint256 indexed destinationChainId,
        address recipient,
        uint256 bridgingCost
    );
    
    event BridgeCompleted(
        address indexed token0,
        address indexed token1,
        uint256 amount0,
        uint256 amount1,
        uint256 indexed destinationChainId,
        address recipient
    );
}