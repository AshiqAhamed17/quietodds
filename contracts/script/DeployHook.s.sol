// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {QuietOddsHook} from "../src/QuietOddsHook.sol";
import {HookConfig} from "./HookConfig.sol";

/// Mines a CREATE2 salt so the hook's address encodes exactly its permissions,
/// then deploys it through the standard CREATE2 factory.
///   forge script script/DeployHook.s.sol --rpc-url sepolia --broadcast --verify \
///     --skip-simulation --slow --with-gas-price 2gwei --priority-gas-price 1000000
contract DeployHook is HookConfig {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        ShieldedPool pool = ShieldedPool(vm.parseJsonAddress(vm.readFile(CORE_JSON), ".ShieldedPool"));

        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(IPoolManager(POOL_MANAGER), pool);
        (address expected, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, flags, type(QuietOddsHook).creationCode, args);

        vm.startBroadcast(pk);
        QuietOddsHook hook = new QuietOddsHook{salt: salt}(IPoolManager(POOL_MANAGER), pool);
        vm.stopBroadcast();
        require(address(hook) == expected, "hook address mismatch");

        string memory k = "hook";
        vm.serializeAddress(k, "ShieldedPool", address(pool));
        vm.serializeBytes32(k, "salt", salt);
        string memory json = vm.serializeAddress(k, "QuietOddsHook", address(hook));
        vm.writeJson(json, HOOK_JSON);
        console.log("QuietOddsHook", address(hook));
    }
}
