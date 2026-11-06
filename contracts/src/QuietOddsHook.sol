// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Pool} from "@uniswap/v4-core/src/libraries/Pool.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Slot0} from "@uniswap/v4-core/src/types/Slot0.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ShieldedPool} from "./ShieldedPool.sol";

/// @title QuietOddsHook
/// @notice The QuietOdds Uniswap v4 hook. Two jobs:
///
///   1. Shield-on-swap. A swap can send part of its USDC straight into the
///      QuietOdds private balance. The swapper later bets from that balance
///      through the relayer, so the swap itself never names a market or a side
///      ("swap-and-bet" is a UI flow on top).
///
///        hookData = abi.encode(uint256 amount, uint256 precommitment, bytes ciphertext)
///        Empty hookData is a plain swap.
///
///      The shielded USDC comes on top of the user's intent where the amount is
///      fixed, and out of it where it isn't:
///
///        USDC in,  exact in   shield is carved from the input     (beforeSwap delta)
///        USDC out, exact in   shield is carved from the output    (afterSwap delta)
///        USDC in,  exact out  the user pays the shield extra      (afterSwap delta)
///        USDC out, exact out  the pool swaps extra for the shield (beforeSwap delta)
///
///      The hook takes the USDC from the PoolManager and deposits it into
///      ShieldedPool like any depositor, so the note leaf is still built by the
///      pool contract from the public amount.
///
///   2. Anti-sandwich guard, ported from OpenZeppelin's AntiSandwichHook
///      (Umbra Research's sandwich-resistant AMM). One-for-zero swaps can never
///      fill better than the pool's state at the start of the block, so the
///      back-run of a zero-for-one sandwich returns no profit. The difference
///      is skimmed and donated to the pool's LPs in the same swap. Changes from
///      OZ: the simulation uses the amount the pool really swaps (after the
///      shield's delta), and the skim shares the afterSwap delta with the shield.
///      Like OZ's, it protects one direction only: zero-for-one victims.
contract QuietOddsHook is BaseHook {
    using SafeERC20 for IERC20;
    using SafeCast for *;
    using StateLibrary for IPoolManager;
    using TransientSlot for *;
    using Pool for *;

    /// The pool's state at the first swap of the block.
    struct Checkpoint {
        uint48 blockNumber;
        Pool.State state;
    }

    ShieldedPool public immutable shieldedPool;
    Currency public immutable usdc;

    mapping(PoolId id => Checkpoint) private _checkpoints;

    // The guard's target, carried from beforeSwap to afterSwap.
    bytes32 private constant TARGET_SLOT = keccak256("quietodds.hook.target");
    bytes32 private constant APPLY_SLOT = keccak256("quietodds.hook.apply");

    event ShieldedOnSwap(PoolId indexed poolId, uint256 amount, uint256 leafIndex);
    event SandwichSkimmed(PoolId indexed poolId, Currency currency, uint256 amount);

    error PoolHasNoUsdc();
    error BadShieldAmount();
    error ShieldExceedsOutput();

    constructor(IPoolManager poolManager_, ShieldedPool shieldedPool_) BaseHook(poolManager_) {
        shieldedPool = shieldedPool_;
        IERC20 usdcToken = shieldedPool_.assets(shieldedPool_.ASSET_USDC());
        usdc = Currency.wrap(address(usdcToken));
        usdcToken.forceApprove(address(shieldedPool_), type(uint256).max);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // --- swap callbacks ------------------------------------------------------

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // Shield: when USDC is the specified side, claim it before the swap, so
        // the pool swaps |specified| - amount (exact in) or |specified| + amount (exact out).
        int128 specifiedDelta;
        if (hookData.length != 0) {
            uint256 amount = _shieldAmount(hookData);
            (bool usdcSpecified,) = _shape(key, params);
            if (usdcSpecified) specifiedDelta = amount.toInt256().toInt128();
        }

        // Guard: snapshot the pool at the block's first swap, then price
        // one-for-zero swaps against that snapshot.
        Checkpoint storage cp = _checkpoint(key);
        if (params.zeroForOne) {
            APPLY_SLOT.asBoolean().tstore(false);
        } else {
            (BalanceDelta simulated,,,) = cp.state.swap(
                Pool.SwapParams({
                    tickSpacing: key.tickSpacing,
                    zeroForOne: false,
                    amountSpecified: params.amountSpecified + specifiedDelta,
                    sqrtPriceLimitX96: params.sqrtPriceLimitX96,
                    lpFeeOverride: 0
                })
            );
            int128 target = params.amountSpecified < 0 ? simulated.amount0() : simulated.amount1();
            TARGET_SLOT.asUint256().tstore(uint256(int256(target < 0 ? -target : target)));
            APPLY_SLOT.asBoolean().tstore(true);
        }

        BeforeSwapDelta delta =
            specifiedDelta == 0 ? BeforeSwapDeltaLibrary.ZERO_DELTA : toBeforeSwapDelta(specifiedDelta, 0);
        return (this.beforeSwap.selector, delta, 0);
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        uint256 skim = _skim(key, params, delta);

        uint256 shieldUnspecified;
        if (hookData.length != 0) shieldUnspecified = _shield(key, params, delta, hookData, skim);

        return (this.afterSwap.selector, (shieldUnspecified + skim).toInt256().toInt128());
    }

    // --- anti-sandwich -------------------------------------------------------

    /// Updates the start-of-block snapshot on the block's first swap.
    /// @dev OZ's version also copies every tick the price crossed since the last
    ///      snapshot, but never the tick bitmap, so its simulation never crosses
    ///      a tick and never reads them. We keep only what the simulation uses:
    ///      price and in-range liquidity. The target therefore assumes constant
    ///      in-range liquidity (exact for full-range positions, which is how this
    ///      pool is seeded), and the first swap on a new pool doesn't loop over
    ///      ~3,000 ticks to reach tick -195,000 (ETH/USDC).
    function _checkpoint(PoolKey calldata key) internal returns (Checkpoint storage cp) {
        PoolId id = key.toId();
        cp = _checkpoints[id];
        uint48 blockNumber = uint48(block.number);
        if (cp.blockNumber == blockNumber) return cp;
        cp.blockNumber = blockNumber;
        cp.state.slot0 = Slot0.wrap(poolManager.extsload(StateLibrary._getPoolStateSlot(id)));
        cp.state.liquidity = poolManager.getLiquidity(id);
    }

    /// What a one-for-zero swap got beyond the start-of-block price, donated to LPs.
    function _skim(PoolKey calldata key, SwapParams calldata params, BalanceDelta delta)
        internal
        returns (uint256 skim)
    {
        if (!APPLY_SLOT.asBoolean().tload()) return 0;
        APPLY_SLOT.asBoolean().tstore(false);
        uint256 target = TARGET_SLOT.asUint256().tload();

        // One-for-zero: the unspecified side is token0 for exact in, token1 for exact out.
        bool exactIn = params.amountSpecified < 0;
        int128 raw = exactIn ? delta.amount0() : delta.amount1();
        uint256 actual = uint256(int256(raw < 0 ? -raw : raw));
        if (exactIn && actual > target) skim = actual - target; // more out than the block started with
        if (!exactIn && actual < target) skim = target - actual; // less in than the block started with
        if (skim == 0) return 0;

        // The donation leaves the hook owing `skim`; the afterSwap delta charges
        // it to the swapper, so no tokens ever sit in the hook.
        Currency currency = exactIn ? key.currency0 : key.currency1;
        poolManager.donate(key, exactIn ? skim : 0, exactIn ? 0 : skim, "");
        emit SandwichSkimmed(key.toId(), currency, skim);
    }

    // --- shield --------------------------------------------------------------

    /// Takes `amount` USDC from the swap and deposits it as a private note.
    /// Returns the part charged through the unspecified delta.
    function _shield(
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData,
        uint256 skim
    ) internal returns (uint256 unspecified) {
        (uint256 amount, uint256 precommitment, bytes memory ciphertext) =
            abi.decode(hookData, (uint256, uint256, bytes));
        (bool usdcSpecified, bool usdcIsInput) = _shape(key, params);

        if (!usdcSpecified) {
            // USDC is the unspecified side: take it from the output, or charge it on the input.
            if (!usdcIsInput) {
                int128 out = usdc == key.currency0 ? delta.amount0() : delta.amount1();
                if (out < (amount + skim).toInt256()) revert ShieldExceedsOutput();
            }
            unspecified = amount;
        }

        // The hook's credit of `amount` USDC is booked when afterSwap returns;
        // taking it now nets out within the same unlock.
        poolManager.take(usdc, address(this), amount);
        uint256 leafIndex = shieldedPool.deposit(shieldedPool.ASSET_USDC(), amount, precommitment, ciphertext);
        emit ShieldedOnSwap(key.toId(), amount, leafIndex);
    }

    function _shieldAmount(bytes calldata hookData) internal pure returns (uint256 amount) {
        amount = abi.decode(hookData[:32], (uint256));
        if (amount == 0 || amount > uint256(uint128(type(int128).max))) revert BadShieldAmount();
    }

    /// @return usdcSpecified whether USDC is the swap's specified currency
    /// @return usdcIsInput whether USDC is paid into the pool
    function _shape(PoolKey calldata key, SwapParams calldata params)
        internal
        view
        returns (bool usdcSpecified, bool usdcIsInput)
    {
        bool usdcIs0 = key.currency0 == usdc;
        if (!usdcIs0 && !(key.currency1 == usdc)) revert PoolHasNoUsdc();
        usdcIsInput = params.zeroForOne == usdcIs0;
        bool exactIn = params.amountSpecified < 0;
        usdcSpecified = usdcIsInput == exactIn;
    }
}
