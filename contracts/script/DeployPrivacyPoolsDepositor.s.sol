// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {IPoolVaultV2} from "../src/interfaces/IPoolVaultV2.sol";
import {PrivacyPoolsDepositor} from "../src/PrivacyPoolsDepositor.sol";

/// Deploys PrivacyPoolsDepositor against the live ShieldedPool on Sepolia.
///   forge script script/DeployPrivacyPoolsDepositor.s.sol --rpc-url sepolia --broadcast --verify
/// Writes deployments/privacy-pools-sepolia.json. Sepolia charges far more for contract
/// creation than forge's local EVM assumes (the node estimates ~5.1M gas vs ~0.77M), so
/// add --gas-estimate-multiplier 750 or the deploy runs out of gas.
contract DeployPrivacyPoolsDepositor is Script {
    // Privacy Pools v2 "V9" on Sepolia (DEPLOYMENTS[11155111].poolAddress in @0xbow/privacy-pools-v2-sdk).
    address constant POOL_VAULT = 0x09b94d3127019298757A6ceeB7911922085f7C01;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address pool = vm.parseJsonAddress(vm.readFile("../deployments/quietodds-sepolia.json"), ".ShieldedPool");

        vm.startBroadcast(pk);
        PrivacyPoolsDepositor depositor = new PrivacyPoolsDepositor(IPoolVaultV2(POOL_VAULT), ShieldedPool(pool));
        vm.stopBroadcast();

        string memory k = "privacyPools";
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeAddress(k, "PoolVault", POOL_VAULT);
        string memory json = vm.serializeAddress(k, "PrivacyPoolsDepositor", address(depositor));
        vm.writeJson(json, "../deployments/privacy-pools-sepolia.json");

        console.log("PrivacyPoolsDepositor", address(depositor));
    }
}
