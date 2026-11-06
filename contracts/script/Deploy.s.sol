// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpendVerifier} from "../src/verifiers/SpendVerifier.sol";
import {RedeemVerifier} from "../src/verifiers/RedeemVerifier.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {Markets} from "../src/Markets.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {BatchSwapper} from "../src/BatchSwapper.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {ResolverReceiver} from "../src/ResolverReceiver.sol";

/// Deploys the QuietOdds core on Sepolia and wires it together.
///   forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify
/// Writes the addresses to deployments/quietodds-sepolia.json.
contract Deploy is Script {
    // Verified in deployments/sepolia.json
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    // CRE MockKeystoneForwarder, used by `cre workflow simulate --broadcast`.
    // Switch with ResolverReceiver.setForwarder for a deployed workflow.
    address constant CRE_SIM_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        SpendVerifier spendVerifier = new SpendVerifier();
        RedeemVerifier redeemVerifier = new RedeemVerifier();
        Markets markets = new Markets(deployer);
        BatchSwapper batches = new BatchSwapper(
            deployer, IPoolManager(POOL_MANAGER), AggregatorV3Interface(ETH_USD_FEED), IERC20(USDC), IERC20(WETH)
        );
        ShieldedPool pool = new ShieldedPool(
            IVerifier(address(spendVerifier)),
            IVerifier(address(redeemVerifier)),
            markets,
            batches,
            IERC20(USDC),
            IERC20(WETH)
        );
        ResolverReceiver receiver = new ResolverReceiver(deployer, markets, CRE_SIM_FORWARDER);
        markets.setPool(address(pool));
        markets.setResolver(address(receiver));
        batches.setPool(pool); // the pool key is set after the hook (DeployHook.s.sol)
        vm.stopBroadcast();

        string memory k = "quietodds";
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeAddress(k, "SpendVerifier", address(spendVerifier));
        vm.serializeAddress(k, "RedeemVerifier", address(redeemVerifier));
        vm.serializeAddress(k, "Markets", address(markets));
        vm.serializeAddress(k, "ResolverReceiver", address(receiver));
        vm.serializeAddress(k, "BatchSwapper", address(batches));
        string memory json = vm.serializeAddress(k, "ShieldedPool", address(pool));
        vm.writeJson(json, "../deployments/quietodds-sepolia.json");

        console.log("ShieldedPool     ", address(pool));
        console.log("Markets          ", address(markets));
        console.log("ResolverReceiver ", address(receiver));
        console.log("BatchSwapper     ", address(batches));
    }
}
