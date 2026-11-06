// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoseidonT5} from "poseidon-solidity/PoseidonT5.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Markets} from "../src/Markets.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {QuietOddsHook} from "../src/QuietOddsHook.sol";

/// Shield-on-swap across every swap shape. Each fuzz run is checked against a
/// control: the same swap without the hook's shield, from the same state.
contract QuietOddsHookTest is Deployers {
    uint160 constant FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    uint256 constant PC = 0x1234567890abcdef; // a note precommitment
    uint256 constant MAX_AMOUNT = 1e15;

    /// One setup per ordering: USDC as currency0, and USDC as currency1.
    struct Setup {
        ShieldedPool pool;
        QuietOddsHook hook;
        PoolKey key;
        Currency usdc;
        Currency other;
    }

    Setup[2] setups;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        Markets markets = new Markets(address(this));
        for (uint256 i = 0; i < 2; i++) {
            Currency usdc_ = i == 0 ? currency0 : currency1;
            Currency other_ = i == 0 ? currency1 : currency0;
            ShieldedPool pool = new ShieldedPool(
                IVerifier(address(0)),
                IVerifier(address(0)),
                markets,
                IERC20(Currency.unwrap(usdc_)),
                IERC20(Currency.unwrap(other_))
            );
            address hookAddr = address(FLAGS | (uint160(i + 1) << 144));
            deployCodeTo("QuietOddsHook.sol:QuietOddsHook", abi.encode(manager, pool), hookAddr);
            (PoolKey memory k,) = initPool(currency0, currency1, IHooks(hookAddr), 3000, SQRT_PRICE_1_1);
            modifyLiquidityRouter.modifyLiquidity(k, ModifyLiquidityParams(-887220, 887220, 1e24, 0), "");
            setups[i] = Setup(pool, QuietOddsHook(hookAddr), k, usdc_, other_);
        }
    }

    function _hookData(uint256 amount) internal pure returns (bytes memory) {
        return abi.encode(amount, PC, hex"c1c2c3");
    }

    /// Swaps and returns this contract's balance changes in (usdc, other).
    function _swap(Setup memory s, bool zeroForOne, int256 amountSpecified, bytes memory hookData)
        internal
        returns (int256 dUsdc, int256 dOther)
    {
        uint256 u = s.usdc.balanceOf(address(this));
        uint256 o = s.other.balanceOf(address(this));
        swap(s.key, zeroForOne, amountSpecified, hookData);
        dUsdc = int256(s.usdc.balanceOf(address(this))) - int256(u);
        dOther = int256(s.other.balanceOf(address(this))) - int256(o);
    }

    /// The control swap, run from the current state and then rolled back.
    function _control(Setup memory s, bool zeroForOne, int256 amountSpecified)
        internal
        returns (int256 dUsdc, int256 dOther)
    {
        uint256 snap = vm.snapshotState();
        (dUsdc, dOther) = _swap(s, zeroForOne, amountSpecified, "");
        vm.revertToState(snap);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_shieldOnEverySwapShape(bool usdcIs0, bool usdcIn, bool exactIn, uint256 amt, uint256 shield)
        public
    {
        Setup memory s = setups[usdcIs0 ? 0 : 1];
        bool zeroForOne = usdcIn == usdcIs0;
        amt = bound(amt, 1e3, MAX_AMOUNT);
        int256 specified = exactIn ? -int256(amt) : int256(amt);

        int256 cUsdc;
        int256 cOther;
        if (usdcIn && exactIn) {
            // Shield carved from the input: only amt - shield is swapped.
            shield = bound(shield, 1, amt - 1);
            (cUsdc, cOther) = _control(s, zeroForOne, -int256(amt - shield));
            cUsdc -= int256(shield);
        } else if (!usdcIn && exactIn) {
            // Shield carved from the output.
            (cUsdc, cOther) = _control(s, zeroForOne, specified);
            shield = bound(shield, 1, uint256(cUsdc));
            cUsdc -= int256(shield);
        } else if (usdcIn && !exactIn) {
            // The user pays the shield on top of the input.
            shield = bound(shield, 1, MAX_AMOUNT);
            (cUsdc, cOther) = _control(s, zeroForOne, specified);
            cUsdc -= int256(shield);
        } else {
            // The pool swaps extra so the user still gets exactly amt out.
            shield = bound(shield, 1, MAX_AMOUNT);
            (cUsdc, cOther) = _control(s, zeroForOne, int256(amt + shield));
            cUsdc -= int256(shield);
        }

        vm.expectEmit(true, true, true, true, address(s.pool));
        emit ShieldedPool.Deposit(address(s.hook), 1, shield, 0);
        (int256 dUsdc, int256 dOther) = _swap(s, zeroForOne, specified, _hookData(shield));

        // The user's balances match the control, less exactly the shield in USDC.
        assertEq(dUsdc, cUsdc, "usdc");
        assertEq(dOther, cOther, "other");
        if (!usdcIn && !exactIn) assertEq(dUsdc, int256(amt), "exact out still exact");
        if (usdcIn && exactIn) assertEq(dUsdc, -int256(amt), "exact in still exact");

        // The shield sits in the ShieldedPool as one note; the hook keeps nothing.
        assertEq(s.usdc.balanceOf(address(s.pool)), shield, "pool holds the shield");
        assertEq(s.pool.nextLeafIndex(), 1);
        assertEq(s.usdc.balanceOf(address(s.hook)), 0);
        assertEq(s.other.balanceOf(address(s.hook)), 0);
    }

    function testFuzz_plainSwapIsUntouched(bool usdcIs0, bool zeroForOne, bool exactIn, uint256 amt) public {
        Setup memory s = setups[usdcIs0 ? 0 : 1];
        amt = bound(amt, 1e3, MAX_AMOUNT);
        int256 specified = exactIn ? -int256(amt) : int256(amt);
        (int256 cUsdc, int256 cOther) = _control(s, zeroForOne, specified);
        (int256 dUsdc, int256 dOther) = _swap(s, zeroForOne, specified, "");
        assertEq(dUsdc, cUsdc);
        assertEq(dOther, cOther);
        assertEq(s.pool.nextLeafIndex(), 0);
    }

    function test_noteLeafIsBuiltFromThePublicAmount() public {
        Setup memory s = setups[0];
        vm.recordLogs();
        _swap(s, true, -1e9, _hookData(2e8)); // USDC in, exact in: shield 0.2 of 1
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("LeafInserted(uint256,uint256,bytes)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(s.pool) || logs[i].topics[0] != sig) continue;
            (uint256 leaf, bytes memory ciphertext) = abi.decode(logs[i].data, (uint256, bytes));
            assertEq(leaf, PoseidonT5.hash([uint256(1), 1, 2e8, PC]));
            assertEq(ciphertext, hex"c1c2c3");
            return;
        }
        fail();
    }

    function test_revertsWhenShieldExceedsOutput() public {
        Setup memory s = setups[0];
        // USDC out, exact in of 1e6 other: output is just under 1e6 USDC.
        vm.expectRevert(_wrapped(s.hook, IHooks.afterSwap.selector, QuietOddsHook.ShieldExceedsOutput.selector));
        swap(s.key, false, -1e6, _hookData(1e6));
    }

    function test_revertsWhenShieldEatsTheWholeExactInput() public {
        Setup memory s = setups[0];
        vm.expectRevert(Hooks.HookDeltaExceedsSwapAmount.selector);
        swap(s.key, true, -1e6, _hookData(1e6 + 1));
    }

    function test_revertsOnZeroShield() public {
        Setup memory s = setups[0];
        vm.expectRevert(_wrapped(s.hook, IHooks.beforeSwap.selector, QuietOddsHook.BadShieldAmount.selector));
        swap(s.key, true, -1e6, _hookData(0));
    }

    function test_revertsOnPoolWithoutUsdc() public {
        Setup memory s = setups[0];
        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        (Currency c0, Currency c1) =
            address(a) < address(b) ? (Currency.wrap(address(a)), Currency.wrap(address(b))) : (Currency.wrap(address(b)), Currency.wrap(address(a)));
        for (uint256 i = 0; i < 2; i++) {
            MockERC20 t = MockERC20(Currency.unwrap(i == 0 ? c0 : c1));
            t.mint(address(this), 1e30);
            t.approve(address(swapRouter), type(uint256).max);
            t.approve(address(modifyLiquidityRouter), type(uint256).max);
        }
        (PoolKey memory k,) = initPool(c0, c1, IHooks(address(s.hook)), 3000, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(k, ModifyLiquidityParams(-887220, 887220, 1e24, 0), "");

        vm.expectRevert(_wrapped(s.hook, IHooks.beforeSwap.selector, QuietOddsHook.PoolHasNoUsdc.selector));
        swap(k, true, -1e6, _hookData(1));
        swap(k, true, -1e6, ""); // plain swaps still work
    }

    function test_hookAddressHasExactlyItsFlags() public view {
        Hooks.validateHookPermissions(IHooks(address(setups[0].hook)), setups[0].hook.getHookPermissions());
    }

    function _wrapped(QuietOddsHook hook, bytes4 callback, bytes4 err) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            callback,
            abi.encodeWithSelector(err),
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }
}
