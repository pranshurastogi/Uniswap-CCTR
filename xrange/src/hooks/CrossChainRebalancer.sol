// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BaseHook } from "v4-periphery/base/hooks/BaseHook.sol";
import { Hooks     } from "v4-core/libraries/Hooks.sol";
import { IPoolManager, PoolKey } from "v4-core/interfaces/IPoolManager.sol";
import { IAcrossRouter          } from "../interfaces/IAcrossRouter.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "v4-core/types/BalanceDelta.sol";
import { INonfungiblePositionManager } from "v4-periphery/interfaces/INonfungiblePositionManager.sol";

/// @title Cross-Chain Trailing-Range Rebalancer Hook
/// @notice Keeps LP ranges centered on price and migrates to the best chain via Across.
contract CrossChainRebalancer is BaseHook {
  IAcrossRouter                   public immutable across;
  INonfungiblePositionManager     public immutable npm;
  uint256[]                       public supportedChains;

  struct RangeConfig {
    int24 width;       // half-width in ticks
    int24 drift;       // ticks to move per rebalance
    int24 lastCenter;  // last center tick used
  }

  /// @dev positionId → its config
  mapping(uint256 => RangeConfig) public configs;

  /// @notice Emitted when a position is rebalanced on-chain
  event Rebalanced(uint256 indexed positionId, int24 newCenter);

  /// @dev Used to abort local settlement once we cross-chain
  error MigratedViaAcross();

  /// @param _poolManager  Uniswap v4 PoolManager address
  /// @param _npm          NonfungiblePositionManager address
  /// @param _across       Across Router address
  /// @param _chains       List of chain IDs to consider for migration
  constructor(
    IPoolManager _poolManager,
    INonfungiblePositionManager _npm,
    IAcrossRouter _across,
    uint256[] memory _chains
  ) BaseHook(_poolManager) {
    npm             = _npm;
    across          = _across;
    supportedChains = _chains;
  }

  /// @inheritdoc BaseHook
  function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
    // Only afterSwapReturnDelta is used
    return Hooks.Permissions({
      beforeInitialize: false,
      afterInitialize:  false,
      beforeAddLiquidity: false,
      afterAddLiquidity:  false,
      beforeRemoveLiquidity: false,
      afterRemoveLiquidity:  false,
      beforeSwap:       false,
      afterSwap:        false,
      beforeDonate:     false,
      afterDonate:      false,
      beforeSwapReturnDelta: false,
      afterSwapReturnDelta:  true,
      afterAddLiquidityReturnDelta: false,
      afterRemoveLiquidityReturnDelta: false
    });
  }

  /// @notice Called by PoolManager on every swap
  function afterSwapReturnDelta(
    address /*sender*/,
    PoolKey calldata poolKey,
    IPoolManager.SwapParams calldata /*params*/,
    bytes calldata hookData
  ) external override returns (bytes4, BalanceDelta memory) {
    // 1) Decode our stored config
    (uint256 positionId, RangeConfig storage cfg) = _decodeHookData(hookData);

    // 2) Read current pool tick
    int24 currentTick = _poolManager.getPool(poolKey).state().tickCurrent;
    int24 center      = cfg.lastCenter;

    // 3) Trailing-range rebalance logic
    if (currentTick > center + cfg.drift) {
      center += cfg.drift;
      _rebalance(positionId, cfg, center);
    } else if (currentTick < center - cfg.drift) {
      center -= cfg.drift;
      _rebalance(positionId, cfg, center);
    }

    // 4) Cross-chain migration logic
    uint256 bestChain = _findBestChain(poolKey);
    if (bestChain != block.chainid) {
      (uint256 amt0, uint256 amt1) = _burnAndCollect(positionId);
      bytes memory data = abi.encode(positionId, cfg);
      // send funds via Across → will callback acrossReceive
      across.crossChainTransfer{value: msg.value}(
        bestChain,
        msg.sender,
        poolKey.token0, amt0,
        poolKey.token1, amt1,
        data
      );
      revert MigratedViaAcross();
    }

    // 5) Allow normal settlement
    return (BaseHook.afterSwapReturnDelta.selector, BalanceDeltaLibrary.ZERO);
  }

  /// @notice Called by Across on the destination chain
  function acrossReceive(
    bytes calldata data,
    uint256 received0,
    uint256 received1
  ) external returns (bytes4) {
    (uint256 positionId, RangeConfig memory cfg) = abi.decode(data, (uint256,RangeConfig));
    _mintPosition(positionId, cfg, received0, received1);
    return this.acrossReceive.selector;
  }

  // —— Internal helper functions —— //

  /// @dev Decode `hookData` and store the config
  function _decodeHookData(bytes calldata hookData)
    internal pure
    returns (uint256, RangeConfig storage)
  {
    (uint256 posId, RangeConfig memory cfg) = abi.decode(hookData, (uint256,RangeConfig));
    // write to storage and return reference
    RangeConfig storage s = configs[posId];
    s.width      = cfg.width;
    s.drift      = cfg.drift;
    s.lastCenter = cfg.lastCenter;
    return (posId, s);
  }

  /// @dev Rebalance: burn old position, mint new around `newCenter`
  function _rebalance(
    uint256 positionId,
    RangeConfig storage cfg,
    int24 newCenter
  ) internal {
    // 1) withdraw amounts
    (uint256 amt0, uint256 amt1) = _burnAndCollect(positionId);

    // 2) compute new bounds
    int24 lo = newCenter - cfg.width;
    int24 hi = newCenter + cfg.width;

    // 3) mint the new/ranged position
    _mintPosition(positionId, cfg, amt0, amt1);

    // 4) update center and emit
    cfg.lastCenter = newCenter;
    emit Rebalanced(positionId, newCenter);
  }

  /// @dev Burn the NFT and collect both token balances
  function _burnAndCollect(uint256 positionId)
    internal returns (uint256 amount0, uint256 amount1)
  {
    npm.burn(positionId);
    (amount0, amount1) = npm.collect(positionId, type(uint128).max, type(uint128).max);
  }

  /// @dev Mint (or top-up) a position with the provided amounts
  function _mintPosition(
    uint256 positionId,
    RangeConfig memory cfg,
    uint256 amt0,
    uint256 amt1
  ) internal {
    // NOTE: In production, store and reuse poolKey.token0, token1, fee
    npm.mint(
      INonfungiblePositionManager.MintParams({
        token0: address(0),        // <-- replace with real token0
        token1: address(0),        // <-- replace with real token1
        fee:    3000,              // e.g. 0.3%
        tickLower: cfg.lastCenter - cfg.width,
        tickUpper: cfg.lastCenter + cfg.width,
        amount0Desired: amt0,
        amount1Desired: amt1,
        amount0Min: 0,
        amount1Min: 0,
        recipient: address(this),
        deadline: block.timestamp
      })
    );
  }

  /// @dev Very naive “best chain” by lowest quoteTransferFee
  function _findBestChain(PoolKey calldata)
    internal view returns (uint256 best)
  {
    best = block.chainid;
    uint256 lowest = type(uint256).max;
    for (uint i; i < supportedChains.length; i++) {
      uint256 cid = supportedChains[i];
      uint256 fee = across.quoteTransferFee(cid, address(0), 1e18);
      if (fee < lowest) {
        lowest = fee;
        best = cid;
      }
    }
  }
}
