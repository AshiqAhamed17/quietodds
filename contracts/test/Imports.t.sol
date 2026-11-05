// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// Compiles every dependency path we rely on, so a broken remapping fails fast.
contract ImportsTest is Test {
    function test_dependenciesResolve() public pure {
        assertTrue(PoseidonT3.hash([uint256(1), uint256(2)]) != 0);
    }
}
