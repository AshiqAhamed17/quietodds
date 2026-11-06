// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {BatchSwapper} from "../src/BatchSwapper.sol";
import {Markets} from "../src/Markets.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {QuietOddsHook} from "../src/QuietOddsHook.sol";

/// The hook's directional fee on a dynamic-fee pool: ordinary swaps pay the
/// base 0.30%, and the back leg of a same-block sandwich pays for the whole
/// move, so sandwiches lose money in both directions.
contract DirectionalFeeTest is Deployers {
    uint160 constant FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    QuietOddsHook hook;
    PoolKey dynamicKey;
    PoolKey staticKey;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        ShieldedPool pool = new ShieldedPool(
            IVerifier(address(0)),
            IVerifier(address(0)),
            new Markets(address(this)),
            BatchSwapper(payable(address(0))),
            IERC20(Currency.unwrap(currency0)),
            IERC20(Currency.unwrap(currency1))
        );
        address hookAddr = address(FLAGS | (uint160(9) << 144));
        deployCodeTo("QuietOddsHook.sol:QuietOddsHook", abi.encode(manager, pool), hookAddr);
        hook = QuietOddsHook(hookAddr);

        (dynamicKey,) = initPool(currency0, currency1, hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);
        (staticKey,) = initPool(currency0, currency1, hook, 3000, SQRT_PRICE_1_1);
        ModifyLiquidityParams memory full = ModifyLiquidityParams(-887220, 887220, 1e24, 0);
        modifyLiquidityRouter.modifyLiquidity(dynamicKey, full, "");
        modifyLiquidityRouter.modifyLiquidity(staticKey, full, "");
        vm.roll(100);
    }

    /// Swaps exact-in and returns (amount paid in, amount received, LP fee charged).
    function _swap(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        internal
        returns (uint256 paid, uint256 got, uint24 fee)
    {
        vm.recordLogs();
        BalanceDelta d = swap(key, zeroForOne, -int256(amountIn), "");
        (int128 a0, int128 a1) = (d.amount0(), d.amount1());
        (paid, got) =
            zeroForOne ? (uint256(int256(-a0)), uint256(int256(a1))) : (uint256(int256(-a1)), uint256(int256(a0)));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(manager) && logs[i].topics[0] == IPoolManager.Swap.selector) {
                (,,,,, fee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
            }
        }
    }

    /// Front-run, victim, back-run in one block. Returns the attacker's profit
    /// in the token they started with.
    function _sandwich(PoolKey memory key, bool zeroForOne, uint256 front, uint256 victim)
        internal
        returns (int256 profit, uint24 backFee)
    {
        (uint256 paid, uint256 got,) = _swap(key, zeroForOne, front);
        _swap(key, zeroForOne, victim);
        (, uint256 back, uint24 fee) = _swap(key, !zeroForOne, got);
        return (int256(back) - int256(paid), fee);
    }

    function test_ordinarySwapsPayTheBaseFee() public {
        (,, uint24 fee) = _swap(dynamicKey, true, 1e21);
        assertEq(fee, 3000, "first swap of the block");
        (,, fee) = _swap(dynamicKey, true, 1e21);
        assertEq(fee, 3000, "same direction");
        vm.roll(block.number + 1);
        (,, fee) = _swap(dynamicKey, false, 1e21);
        assertEq(fee, 3000, "a new block starts fresh");
    }

    function test_reversingSwapPaysTheMove() public {
        _swap(dynamicKey, true, 1e22); // price down ~2%
        uint24 quoted = hook.directionalFee(dynamicKey, false);
        assertEq(hook.directionalFee(dynamicKey, true), 3000, "continuing the move is not taxed");
        assertGt(quoted, 3000 + 19_000);
        assertLt(quoted, 3000 + 21_000);

        (,, uint24 fee) = _swap(dynamicKey, false, 1e21);
        assertEq(fee, quoted);

        vm.roll(block.number + 1);
        (,, fee) = _swap(dynamicKey, false, 1e21);
        assertEq(fee, 3000);
    }

    function test_staticFeePoolIsUnchanged() public {
        _swap(staticKey, true, 1e22);
        (,, uint24 fee) = _swap(staticKey, false, 1e21);
        assertEq(fee, 3000);
    }

    /// Without the fee, the direction the guard doesn't cover is sandwichable:
    /// one-for-zero front-run, one-for-zero victim, zero-for-one back-run.
    function test_controlSandwichProfitsOnStaticPool() public {
        (int256 profit,) = _sandwich(staticKey, false, 1e22, 5e22);
        assertGt(profit, 0);
    }

    function test_sameSandwichLosesOnDynamicPool() public {
        (int256 profit, uint24 backFee) = _sandwich(dynamicKey, false, 1e22, 5e22);
        assertLt(profit, 0);
        assertGt(backFee, 3000);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_sandwichNeverProfitsEitherDirection(bool zeroForOne, uint256 front, uint256 victim) public {
        front = bound(front, 1e15, 1e23);
        victim = bound(victim, 1e15, 2e23);
        (int256 profit,) = _sandwich(dynamicKey, zeroForOne, front, victim);
        assertLe(profit, 0);
    }

    function test_feeIsCapped() public {
        _swap(dynamicKey, true, 1e25); // crash the price
        assertEq(hook.directionalFee(dynamicKey, false), hook.MAX_REVERSAL_FEE());
    }
}
