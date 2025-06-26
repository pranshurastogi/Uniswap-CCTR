// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CrossChainUtils
 * @notice Utility functions for cross-chain operations
 * @dev Provides common functionality for bridging and chain interactions
 */
library CrossChainUtils {
    uint256 private constant BASIS_POINTS = 10000;
    
    // Chain configuration struct
    struct ChainConfig {
        uint256 chainId;
        address spokePool;
        address bridgeToken;
        uint256 gasLimit;
        uint256 confirmationBlocks;
        bool isActive;
    }
    
    // Bridge fee structure
    struct BridgeFees {
        uint256 baseFee;        // Base fee in wei
        uint256 percentageFee;  // Percentage fee in basis points
        uint256 gasPrice;       // Gas price for destination chain
        uint256 relayerFee;     // Relayer fee in basis points
    }
    
    // Error definitions
    error InvalidChainId();
    error InsufficientBalance();
    error InvalidTokenAddress();
    error ChainNotSupported();
    error InvalidFeeStructure();
    
    /**
     * @notice Calculates bridging fees for cross-chain transfer
     * @param amount Amount to bridge
     * @param destChainId Destination chain ID
     * @param fees Fee structure
     * @return totalFees Total fees required for bridging
     */
    function calculateBridgeFees(
        uint256 amount,
        uint256 destChainId,
        BridgeFees memory fees
    ) internal pure returns (uint256 totalFees) {
        if (amount == 0) revert InsufficientBalance();
        if (destChainId == 0) revert InvalidChainId();
        
        // Calculate percentage fee
        uint256 percentageFee = (amount * fees.percentageFee) / BASIS_POINTS;
        
        // Calculate relayer fee
        uint256 relayerFee = (amount * fees.relayerFee) / BASIS_POINTS;
        
        // Total fees = base fee + percentage fee + gas costs + relayer fee
        totalFees = fees.baseFee + percentageFee + fees.gasPrice + relayerFee;
    }
    
    /**
     * @notice Validates token address and balance for bridging
     * @param token Token address to validate
     * @param account Account to check balance for
     * @param amount Amount to bridge
     * @return isValid Whether the token and balance are valid
     */
    function validateTokenForBridging(
        address token,
        address account,
        uint256 amount
    ) internal view returns (bool isValid) {
        if (token == address(0)) return false;
        if (account == address(0)) return false;
        if (amount == 0) return false;
        
        try IERC20(token).balanceOf(account) returns (uint256 balance) {
            return balance >= amount;
        } catch {
            return false;
        }
    }
    
    /**
     * @notice Encodes cross-chain message data
     * @param recipient Recipient address on destination chain
     * @param token0 First token address
     * @param token1 Second token address
     * @param amount0 Amount of first token
     * @param amount1 Amount of second token
     * @param poolKey Pool identifier for recreation
     * @return encodedData Encoded message data
     */
    function encodeMessageData(
        address recipient,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes32 poolKey
    ) internal pure returns (bytes memory encodedData) {
        encodedData = abi.encode(
            recipient,
            token0,
            token1,
            amount0,
            amount1,
            poolKey,
            block.timestamp
        );
    }
    
    /**
     * @notice Decodes cross-chain message data
     * @param encodedData Encoded message data
     * @return recipient Recipient address
     * @return token0 First token address
     * @return token1 Second token address
     * @return amount0 Amount of first token
     * @return amount1 Amount of second token
     * @return poolKey Pool identifier
     * @return timestamp Message timestamp
     */
    function decodeMessageData(bytes memory encodedData) 
        internal 
        pure 
        returns (
            address recipient,
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1,
            bytes32 poolKey,
            uint256 timestamp
        ) 
    {
        (recipient, token0, token1, amount0, amount1, poolKey, timestamp) = 
            abi.decode(encodedData, (address, address, address, uint256, uint256, bytes32, uint256));
    }
    
    /**
     * @notice Calculates optimal slippage for cross-chain swaps
     * @param chainId Destination chain ID
     * @param volatility Token pair volatility (basis points)
     * @param bridgeTime Estimated bridge time in seconds
     * @return slippage Recommended slippage tolerance in basis points
     */
    function calculateOptimalSlippage(
        uint256 chainId,
        uint256 volatility,
        uint256 bridgeTime
    ) internal pure returns (uint256 slippage) {
        // Base slippage based on chain congestion
        uint256 baseSlippage = _getBaseSlippageForChain(chainId);
        
        // Add volatility-based slippage
        uint256 volatilitySlippage = (volatility * bridgeTime) / 3600; // Per hour
        
        // Add time-based slippage (longer bridge time = more slippage)
        uint256 timeSlippage = (bridgeTime * 10) / 3600; // 10 bps per hour
        
        slippage = baseSlippage + volatilitySlippage + timeSlippage;
        
        // Cap at maximum slippage
        if (slippage > 1000) slippage = 1000; // 10% max
    }
    
    /**
     * @notice Gets base slippage for different chains based on typical congestion
     * @param chainId Chain ID
     * @return baseSlippage Base slippage in basis points
     */
    function _getBaseSlippageForChain(uint256 chainId) private pure returns (uint256 baseSlippage) {
        if (chainId == 1) return 50;        // Ethereum: 0.5%
        if (chainId == 137) return 30;      // Polygon: 0.3%
        if (chainId == 42161) return 25;    // Arbitrum: 0.25%
        if (chainId == 10) return 25;       // Optimism: 0.25%
        if (chainId == 8453) return 20;     // Base: 0.2%
        return 40; // Default: 0.4%
    }
    
    /**
     * @notice Validates chain configuration
     * @param config Chain configuration to validate
     * @return isValid Whether the configuration is valid
     */
    function validateChainConfig(ChainConfig memory config) internal pure returns (bool isValid) {
        return config.chainId > 0 &&
               config.spokePool != address(0) &&
               config.gasLimit > 0 &&
               config.confirmationBlocks > 0;
    }
    
    /**
     * @notice Calculates time to finality for different chains
     * @param chainId Chain ID
     * @return timeToFinality Time in seconds
     */
    function getTimeToFinality(uint256 chainId) internal pure returns (uint256 timeToFinality) {
        if (chainId == 1) return 900;       // Ethereum: ~15 minutes
        if (chainId == 137) return 300;     // Polygon: ~5 minutes
        if (chainId == 42161) return 120;   // Arbitrum: ~2 minutes
        if (chainId == 10) return 180;      // Optimism: ~3 minutes
        if (chainId == 8453) return 60;     // Base: ~1 minute
        return 600; // Default: 10 minutes
    }
    
    /**
     * @notice Estimates gas cost for cross-chain operation
     * @param chainId Destination chain ID
     * @param gasPrice Gas price on destination chain
     * @param complexity Operation complexity (1-5 scale)
     * @return estimatedGas Estimated gas cost in destination chain native token
     */
    function estimateGasCost(
        uint256 chainId,
        uint256 gasPrice,
        uint256 complexity
    ) internal pure returns (uint256 estimatedGas) {
        uint256 baseGas = _getBaseGasForChain(chainId);
        uint256 complexityMultiplier = 100 + (complexity * 50); // 150% for complexity 1, 350% for complexity 5
        
        estimatedGas = (baseGas * complexityMultiplier * gasPrice) / 100;
    }
    
    /**
     * @notice Gets base gas consumption for different chains
     * @param chainId Chain ID
     * @return baseGas Base gas units
     */
    function _getBaseGasForChain(uint256 chainId) private pure returns (uint256 baseGas) {
        if (chainId == 1) return 200000;    // Ethereum
        if (chainId == 137) return 150000;  // Polygon
        if (chainId == 42161) return 180000; // Arbitrum
        if (chainId == 10) return 150000;   // Optimism
        if (chainId == 8453) return 120000; // Base
        return 180000; // Default
    }
    
    /**
     * @notice Checks if a migration is time-sensitive
     * @param currentYield Current yield rate (basis points)
     * @param targetYield Target yield rate (basis points)
     * @param positionValue Total position value
     * @param timeWindow Time window for migration (seconds)
     * @return isTimeSensitive Whether immediate migration is recommended
     */
    function isTimeSensitiveMigration(
        uint256 currentYield,
        uint256 targetYield,
        uint256 positionValue,
        uint256 timeWindow
    ) internal pure returns (bool isTimeSensitive) {
        if (targetYield <= currentYield) return false;
        
        uint256 yieldDifference = targetYield - currentYield;
        uint256 opportunityCost = (positionValue * yieldDifference * timeWindow) / (365 days * BASIS_POINTS);
        
        // Time-sensitive if opportunity cost > 0.1% of position value
        return opportunityCost > (positionValue / 1000);
    }
    
    /**
     * @notice Formats chain-specific addresses for display
     * @param chainId Chain ID
     * @param addr Address to format
     * @return formattedAddress Chain-specific formatted address
     */
    function formatAddressForChain(
        uint256 chainId,
        address addr
    ) internal pure returns (string memory formattedAddress) {
        string memory prefix = _getChainPrefix(chainId);
        formattedAddress = string(abi.encodePacked(prefix, ":", _addressToString(addr)));
    }
    
    /**
     * @notice Gets chain prefix for address formatting
     * @param chainId Chain ID
     * @return prefix Chain prefix string
     */
    function _getChainPrefix(uint256 chainId) private pure returns (string memory prefix) {
        if (chainId == 1) return "eth";
        if (chainId == 137) return "matic";
        if (chainId == 42161) return "arb";
        if (chainId == 10) return "op";
        if (chainId == 8453) return "base";
        return "unknown";
    }
    
    /**
     * @notice Converts address to string
     * @param addr Address to convert
     * @return addressString String representation of address
     */
    function _addressToString(address addr) private pure returns (string memory addressString) {
        bytes32 value = bytes32(uint256(uint160(addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3 + i * 2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        
        return string(str);
    }
    
    /**
     * @notice Creates a deterministic migration ID
     * @param user User address
     * @param fromChain Source chain ID
     * @param toChain Destination chain ID
     * @param token0 First token address
     * @param token1 Second token address
     * @param nonce Unique nonce
     * @return migrationId Deterministic migration ID
     */
    function createMigrationId(
        address user,
        uint256 fromChain,
        uint256 toChain,
        address token0,
        address token1,
        uint256 nonce
    ) internal view returns (bytes32 migrationId) {
        migrationId = keccak256(abi.encodePacked(
            user,
            fromChain,
            toChain,
            token0,
            token1,
            nonce,
            block.timestamp,
            block.difficulty
        ));
    }
}
