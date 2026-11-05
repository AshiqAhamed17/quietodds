// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpendVerifier} from "../src/verifiers/SpendVerifier.sol";
import {RedeemVerifier} from "../src/verifiers/RedeemVerifier.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {Markets} from "../src/Markets.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {TestToken} from "../test/ShieldedPool.t.sol";

/// A throwaway QuietOdds on a local anvil, for relayer and script tests.
/// Mintable tokens, the deployer as resolver, and one open 2-sided market.
///   forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
/// Writes the addresses to deployments/quietodds-local.json (gitignored).
contract DeployLocal is Script {
    function run() external {
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        TestToken usdc = new TestToken("USDC", 6);
        TestToken weth = new TestToken("WETH", 18);
        Markets markets = new Markets(deployer);
        ShieldedPool pool = new ShieldedPool(
            IVerifier(address(new SpendVerifier())),
            IVerifier(address(new RedeemVerifier())),
            markets,
            IERC20(address(usdc)),
            IERC20(address(weth))
        );
        markets.setPool(address(pool));
        markets.setResolver(deployer);
        markets.createMarket(
            "Local test market", "No|Yes", 2, uint64(block.timestamp + 1 days), Markets.Source.Sports, "", address(0), 0
        );
        vm.stopBroadcast();

        string memory k = "local";
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeAddress(k, "USDC", address(usdc));
        vm.serializeAddress(k, "WETH", address(weth));
        vm.serializeAddress(k, "Markets", address(markets));
        string memory json = vm.serializeAddress(k, "ShieldedPool", address(pool));
        vm.writeJson(json, "../deployments/quietodds-local.json");
    }
}
