// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TickMath} from "@uniswap/v4-core/contracts/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/contracts/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/contracts/libraries/LiquidityAmounts.sol";

library PositionMath {
    uint256 private constant Q96 = 2**96;
    
    /// @notice Aligns tick to the pool's tick spacing
    /// @param tick The tick to align
    /// @param fee The pool fee tier
    /// @return alignedTick The aligned tick
    function alignToTickSpacing(int24 tick, uint24 fee) internal pure returns (int24 alignedTick) {
        int24 tickSpacing = getTickSpacing(fee);
        
        alignedTick = tick / tickSpacing * tickSpacing;
        
        // Ensure the tick is within valid bounds
        if (alignedTick < TickMath.MIN_TICK) {
            alignedTick = TickMath.MIN_TICK;
        } else if (alignedTick > TickMath.MAX_TICK) {
            alignedTick = TickMath.MAX_TICK;
        }
    }
    
    /// @notice Gets tick spacing for a given fee tier
    /// @param fee The fee tier
    /// @return tickSpacing The tick spacing
    function getTickSpacing(uint24 fee) internal pure returns (int24 tickSpacing) {
        if (fee == 100) {
            tickSpacing = 1;
        } else if (fee == 500) {
            tickSpacing = 10;
        } else if (fee == 3000) {
            tickSpacing = 60;
        } else if (fee == 10000) {
            tickSpacing = 200;
        } else {
            revert("Invalid fee tier");
        }
    }
    
    /// @notice Calculates liquidity amount from token balances
    /// @param amount0 Token0 balance
    /// @param amount1 Token1 balance
    /// @param tickLower Lower tick of the position
    /// @param tickUpper Upper tick of the position
    /// @return liquidity The calculated liquidity amount
    function calculateLiquidityFromBalances(
        uint256 amount0,
        uint256 amount1,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (uint128 liquidity) {
        uint160 sqrtPriceAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        
        // For simplicity, assume current price is in the middle of the range
        uint160 sqrtPriceX96 = uint160((uint256(sqrtPriceAX96) + uint256(sqrtPriceBX96)) / 2);
        
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            amount0,
            amount1
        );
    }
    
    /// @notice Calculates token amounts for a given liquidity
    /// @param liquidity The liquidity amount
    /// @param sqrtPriceX96 Current sqrt price
    /// @param tickLower Lower tick
    /// @param tickUpper Upper tick
    /// @return amount0 Token0 amount
    /// @return amount1 Token1 amount
    function getAmountsForLiquidity(
        uint128 liquidity,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        uint160 sqrtPriceAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtRatioAtTick(tickUpper);
        
        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtPriceX96,
            sqrtPriceAX96,
            sqrtPriceBX96,
            liquidity
        );
    }
    
    /// @notice Calculates optimal range width based on volatility
    /// @param volatility Historical volatility (basis points)
    /// @param fee Pool fee tier
    /// @return rangeWidth Optimal range width in ticks
    function calculateOptimalRangeWidth(
        uint256 volatility,
        uint24 fee
    ) internal pure returns (uint24 rangeWidth) {
        // Base range calculation based on fee tier
        uint24 baseRange = fee == 100 ? 20 : fee == 500 ? 60 : fee == 3000 ? 200 : 400;
        
        // Adjust based on volatility
        // Higher volatility = wider range to reduce rebalancing frequency
        uint256 volatilityMultiplier = 10000 + (volatility * 2); // 2x volatility factor
        rangeWidth = uint24((uint256(baseRange) * volatilityMultiplier) / 10000);
        
        // Ensure minimum and maximum bounds
        if (rangeWidth < 20) rangeWidth = 20;
        if (rangeWidth > 1000) rangeWidth = 1000;
    }
    
    /// @notice Calculates impermanent loss for a position
    /// @param priceRatio Current price / initial price (in Q96 format)
    /// @return impermanentLoss IL as a percentage (basis points)
    function calculateImpermanentLoss(uint256 priceRatio) internal pure returns (uint256 impermanentLoss) {
        if (priceRatio == Q96) return 0; // No price change
        
        // Simplified IL calculation: IL = 2*sqrt(ratio)/(1+ratio) - 1
        uint256 sqrtRatio = sqrt(priceRatio);
        uint256 denominator = Q96 + priceRatio;
        
        if (denominator == 0) return 0;
        
        uint256 il = (2 * sqrtRatio * Q96) / denominator;
        
        if (il > Q96) {
            impermanentLoss = ((il - Q96) * 10000) / Q96;
        } else {
            impermanentLoss = 0;
        }
    }
    
    /// @notice Estimates gas cost for rebalancing operation
    /// @param currentGasPrice Current gas price
    /// @param hasLiquidity Whether position currently has liquidity
    /// @return estimatedCost Estimated gas cost in ETH
    function estimateRebalancingCost(
        uint256 currentGasPrice,
        bool hasLiquidity
    ) internal pure returns (uint256 estimatedCost) {
        // Base gas costs for different operations
        uint256 removeGas = hasLiquidity ? 150000 : 0; // Remove liquidity
        uint256 addGas = 120000; // Add liquidity
        uint256 hookGas = 50000; // Hook execution overhead
        
        uint256 totalGas = removeGas + addGas + hookGas;
        estimatedCost = totalGas * currentGasPrice;
    }
    
    /// @notice Calculates profit threshold for rebalancing
    /// @param currentFees Accumulated fees in the position
    /// @param rebalancingCost Cost of rebalancing operation
    /// @param profitMargin Required profit margin (basis points)
    /// @return shouldRebalance Whether rebalancing is profitable
    function isProfitableToRebalance(
        uint256 currentFees,
        uint256 rebalancingCost,
        uint256 profitMargin
    ) internal pure returns (bool shouldRebalance) {
        uint256 requiredProfit = (rebalancingCost * (10000 + profitMargin)) / 10000;
        shouldRebalance = currentFees >= requiredProfit;
    }
    
    /// @notice Simple integer square root
    /// @param x Input value
    /// @return y Square root of x
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
    
    /// @notice Calculates time-weighted average price impact
    /// @param trades Array of recent trade sizes
    /// @param timeWeights Array of time weights (more recent = higher weight)
    /// @return avgImpact Weighted average price impact
    function calculateWeightedPriceImpact(
        uint256[] memory trades,
        uint256[] memory timeWeights
    ) internal pure returns (uint256 avgImpact) {
        require(trades.length == timeWeights.length, "Array length mismatch");
        
        uint256 totalWeightedImpact;
        uint256 totalWeight;
        
        for (uint256 i = 0; i < trades.length; i++) {
            // Simplified price impact calculation: impact = trade_size^0.5
            uint256 impact = sqrt(trades[i] * 1e18); // Scale for precision
            totalWeightedImpact += impact * timeWeights[i];
            totalWeight += timeWeights[i];
        }
        
        if (totalWeight == 0) return 0;
        avgImpact = totalWeightedImpact / totalWeight;
    }
}