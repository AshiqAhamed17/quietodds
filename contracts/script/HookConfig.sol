// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// Shared Sepolia addresses and the QuietOdds ETH/USDC pool key.
/// Verified in deployments/sepolia.json.
abstract contract HookConfig is Script {
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    /// Dynamic: the hook charges 0.30%, or more for a swap that reverses the block's move.
    uint24 constant FEE = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant TICK_SPACING = 60;

    string constant CORE_JSON = "../deployments/quietodds-sepolia.json";
    string constant HOOK_JSON = "../deployments/hook-sepolia.json";

    /// Native ETH / USDC, so currency0 is ETH.
    function poolKey(address hook) internal pure returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(USDC), FEE, TICK_SPACING, IHooks(hook));
    }

    function hookAddress() internal view returns (address) {
        return vm.parseJsonAddress(vm.readFile(HOOK_JSON), ".QuietOddsHook");
    }
}
