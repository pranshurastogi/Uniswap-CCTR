// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "v4-periphery/interfaces/INonfungiblePositionManager.sol";

contract MockPositionManager is INonfungiblePositionManager {
  mapping(uint256 => (uint256,uint256)) public lastMint;

  function burn(uint256) external override {
    // no-op
  }

  function collect(
    uint256, uint128, uint128
  ) external pure override returns (uint256 amount0, uint256 amount1) {
    return (1e18, 2e18);
  }

  function mint(MintParams calldata p)
    external override returns (uint256 tokenId, uint128 liquidity, uint256 amt0, uint256 amt1)
  {
    lastMint[1] = (p.amount0Desired, p.amount1Desired);
    return (1, 0, p.amount0Desired, p.amount1Desired);
  }

  // stub out the rest of the interface...
  function decreaseLiquidity(DecreaseParams calldata) external override returns (uint256,uint256) { revert(); }
  function positions(uint256) external view override returns (Position memory) { revert(); }
  function factory() external view override returns (address) { return address(0); }
  function WETH9() external view override returns (address) { return address(0); }
}
