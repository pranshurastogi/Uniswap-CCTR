// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Simple interface for Across CCTP bridging
interface IAcrossRouter {
  /// @notice Bridges token0 and token1 from this chain to `toChainId`,
  /// then calls back `acrossReceive` on the hook with `data`.
  function crossChainTransfer(
    uint256 toChainId,
    address recipient,
    address token0,
    uint256 amount0,
    address token1,
    uint256 amount1,
    bytes calldata data
  ) external payable;

  /// @notice Quotes the fee (in native gas token) for bridging `amount` of `token`.
  function quoteTransferFee(
    uint256 toChainId,
    address token,
    uint256 amount
  ) external view returns (uint256);
}
