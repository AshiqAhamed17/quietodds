// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {HookConfig} from "./HookConfig.sol";

/// Opens the ETH/USDC pool with our hook at the Chainlink ETH/USD price.
contract CreatePool is HookConfig {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        PoolKey memory key = poolKey(hookAddress());
        uint160 sqrtPriceX96 = sqrtPriceFromFeed();

        vm.startBroadcast(pk);
        int24 tick = IPoolManager(POOL_MANAGER).initialize(key, sqrtPriceX96);
        vm.stopBroadcast();

        bytes32 id = PoolId.unwrap(key.toId());
        vm.writeJson(vm.toString(id), HOOK_JSON, ".poolId");
        console.log("pool initialized at tick", tick);
        console.logBytes32(id);
    }

    /// price (USDC base units per wei) = answer / 1e8 * 1e6 / 1e18 = answer / 1e20
    /// sqrtPriceX96 = sqrt(price) * 2^96 = sqrt(answer * 2^192 / 1e20)
    function sqrtPriceFromFeed() internal view returns (uint160) {
        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(ETH_USD_FEED).latestRoundData();
        require(answer > 0 && block.timestamp - updatedAt < 1 days, "bad feed");
        console.log("ETH/USD (8dp)", uint256(answer));
        return uint160(Math.sqrt((uint256(answer) << 192) / 1e20));
    }
}
