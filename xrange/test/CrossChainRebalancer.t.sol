// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../src/hooks/CrossChainRebalancer.sol";
import "./mocks/MockAcross.sol";
import "./mocks/MockPositionManager.sol";
import "v4-core/interfaces/IPoolManager.sol";

contract CrossChainRebalancerTest is Test {
  CrossChainRebalancer hook;
  MockAcross           across;
  MockPositionManager  npm;
  IPoolManager         pm = IPoolManager(address(0x1234));

  function setUp() public {
    across = new MockAcross();
    npm    = new MockPositionManager();
    uint256;
    chains[0] = block.chainid;
    chains[1] = block.chainid + 1;
    hook = new CrossChainRebalancer(pm, npm, across, chains);
  }

  function testRebalanceEmitted() public {
    // prepare hookData: positionId=1, width=5, drift=2, center=10
    bytes memory hd = abi.encode(uint256(1), CrossChainRebalancer.RangeConfig({
      width:      5,
      drift:      2,
      lastCenter: 10
    }));
    // Expect a Rebalanced event with newCenter = 12
    vm.expectEmit(true, true, true, true);
    emit hook.Rebalanced(1, 12);

    // Call afterSwapReturnDelta directly with currentTick=13
    hook.afterSwapReturnDelta(
      address(this),
      IPoolManager.PoolKey({token0:address(0), token1:address(0), fee:3000, hook:address(hook)}),
      IPoolManager.SwapParams({amountIn:0, amountOutMinimum:0, sqrtPriceLimitX96:0}),
      hd
    );
  }

  function testCrossChainReverts() public {
    bytes memory hd = abi.encode(uint256(1), CrossChainRebalancer.RangeConfig({
      width:      5,
      drift:      2,
      lastCenter: 10
    }));
    // Best chain will be chains[1] → should revert
    vm.expectRevert(CrossChainRebalancer.MigratedViaAcross.selector);
    hook.afterSwapReturnDelta(
      address(this),
      IPoolManager.PoolKey({token0:address(0), token1:address(0), fee:3000, hook:address(hook)}),
      IPoolManager.SwapParams({amountIn:0, amountOutMinimum:0, sqrtPriceLimitX96:0}),
      hd
    );
  }
}
