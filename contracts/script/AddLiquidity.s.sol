// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {HookConfig} from "./HookConfig.sol";

/// Mints a full-range position (an NFT owned by the deployer) through the
/// PositionManager. Full range keeps the guard's constant-liquidity
/// simulation exact. Amount: USDC_LIQUIDITY (base units), matched in ETH.
contract AddLiquidity is HookConfig {
    using StateLibrary for IPoolManager;

    int24 constant TICK_LOWER = -887220;
    int24 constant TICK_UPPER = 887220;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        uint256 usdcAmount = vm.envOr("USDC_LIQUIDITY", uint256(25e6));
        PoolKey memory key = poolKey(hookAddress());

        (uint160 sqrtPriceX96,,,) = IPoolManager(POOL_MANAGER).getSlot0(key.toId());
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(TICK_LOWER);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(TICK_UPPER);
        // ETH needed for usdcAmount at the pool price, with 1% headroom (the rest is swept back).
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount1(sqrtA, sqrtPriceX96, usdcAmount);
        uint256 ethMax = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtB, liquidity, true) * 101 / 100 + 1;

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(key, TICK_LOWER, TICK_UPPER, uint256(liquidity), ethMax, usdcAmount + 1, me, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        params[2] = abi.encode(Currency.wrap(address(0)), me);

        vm.startBroadcast(pk);
        IERC20(USDC).approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2).approve(USDC, POSITION_MANAGER, type(uint160).max, uint48(block.timestamp + 1 days));
        uint256 tokenId = IPositionManager(POSITION_MANAGER).nextTokenId();
        IPositionManager(POSITION_MANAGER).modifyLiquidities{value: ethMax}(abi.encode(actions, params), block.timestamp + 1 hours);
        vm.stopBroadcast();

        vm.writeJson(vm.toString(tokenId), HOOK_JSON, ".positionId");
        console.log("position", tokenId, "liquidity", liquidity);
        console.log("ETH max (wei)", ethMax, "USDC", usdcAmount);
    }
}
