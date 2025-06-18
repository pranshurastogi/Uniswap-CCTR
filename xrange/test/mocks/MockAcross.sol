// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "../../src/interfaces/IAcrossRouter.sol";

contract MockAcross is IAcrossRouter {
  event Bridged(uint256 toChain, address recipient, uint256 amt0, uint256 amt1, bytes data);

  function crossChainTransfer(
    uint256 toChainId,
    address recipient,
    address token0,
    uint256 amount0,
    address token1,
    uint256 amount1,
    bytes calldata data
  ) external payable override {
    emit Bridged(toChainId, recipient, amount0, amount1, data);
  }

  function quoteTransferFee(
    uint256, address, uint256
  ) external pure override returns (uint256) {
    return 1e15;  // constant dummy fee
  }
}
