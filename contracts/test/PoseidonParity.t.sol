// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT5} from "poseidon-solidity/PoseidonT5.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";

/// The same vectors are asserted in circuits/lib/src/parity.nr and printed by
/// scripts/poseidon-parity.mjs. On-chain leaves must hash exactly like the circuits.
contract PoseidonParityTest is Test {
    function test_hash2() public pure {
        assertEq(PoseidonT3.hash([uint256(1), 2]), 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a);
    }

    function test_hash4() public pure {
        assertEq(
            PoseidonT5.hash([uint256(1), 2, 3, 4]), 0x299c867db6c1fdd79dcefa40e4510b9837e60ebb1ce0663dbaa525df65250465
        );
    }

    function test_hash5() public pure {
        assertEq(
            PoseidonT6.hash([uint256(1), 2, 3, 4, 5]),
            0x0dab9449e4a1398a15224c0b15a49d598b2174d305a316c918125f8feeb123c0
        );
    }
}
