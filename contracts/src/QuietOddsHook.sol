// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ShieldedPool} from "./ShieldedPool.sol";

/// @title QuietOddsHook
/// @notice Shield-on-swap for Uniswap v4: a swap can send part of its USDC
///         straight into the QuietOdds private balance. The swapper later bets
///         from that balance through the relayer, so the swap itself never
///         names a market or a side ("swap-and-bet" is a UI flow on top).
///
///         hookData = abi.encode(uint256 amount, uint256 precommitment, bytes ciphertext)
///         Empty hookData is a plain swap.
///
///         Every swap shape works; the shielded USDC always comes on top of the
///         user's intent where the amount is fixed, and out of it where it isn't:
///
///           USDC in,  exact in   shield is carved from the input    (beforeSwap delta)
///           USDC out, exact in   shield is carved from the output   (afterSwap delta)
///           USDC in,  exact out  the user pays the shield extra     (afterSwap delta)
///           USDC out, exact out  the pool swaps extra for the shield (beforeSwap delta)
///
///         The hook takes the USDC from the PoolManager and deposits it into
///         ShieldedPool like any depositor, so the note leaf is still built by
///         the pool contract from the public amount.
contract QuietOddsHook is BaseHook {
    using SafeERC20 for IERC20;

    ShieldedPool public immutable shieldedPool;
    Currency public immutable usdc;

    event ShieldedOnSwap(bytes32 indexed poolId, uint256 amount, uint256 leafIndex);

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
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (hookData.length == 0) return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        uint256 amount = _shieldAmount(hookData);
        (bool usdcSpecified,) = _shape(key, params);
        // USDC is the specified side: claim it before the swap, so the pool
        // swaps |specified| - amount (exact in) or |specified| + amount (exact out).
        BeforeSwapDelta delta =
            usdcSpecified ? toBeforeSwapDelta(int128(int256(amount)), 0) : BeforeSwapDeltaLibrary.ZERO_DELTA;
        return (this.beforeSwap.selector, delta, 0);
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        if (hookData.length == 0) return (this.afterSwap.selector, 0);
        (uint256 amount, uint256 precommitment, bytes memory ciphertext) =
            abi.decode(hookData, (uint256, uint256, bytes));
        (bool usdcSpecified, bool usdcIsInput) = _shape(key, params);

        int128 unspecifiedDelta;
        if (!usdcSpecified) {
            // USDC is the unspecified side: take it from the output, or charge it on the input.
            if (!usdcIsInput) {
                int128 out = usdc == key.currency0 ? delta.amount0() : delta.amount1();
                if (out < int128(int256(amount))) revert ShieldExceedsOutput();
            }
            unspecifiedDelta = int128(int256(amount));
        }

        // The hook's credit of `amount` USDC is booked when this call returns;
        // taking it now nets out within the same unlock.
        poolManager.take(usdc, address(this), amount);
        uint256 leafIndex = shieldedPool.deposit(shieldedPool.ASSET_USDC(), amount, precommitment, ciphertext);
        emit ShieldedOnSwap(keccak256(abi.encode(key)), amount, leafIndex);
        return (this.afterSwap.selector, unspecifiedDelta);
    }

    // --- internals -----------------------------------------------------------

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
