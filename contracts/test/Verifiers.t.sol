// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {SpendVerifier} from "../src/verifiers/SpendVerifier.sol";
import {RedeemVerifier} from "../src/verifiers/RedeemVerifier.sol";

/// Real proofs from scripts/gen-fixtures.mjs verify against the bb-generated
/// Solidity verifiers, and any tampered public input is rejected.
contract VerifiersTest is Test {
    SpendVerifier spend;
    RedeemVerifier redeem;

    function setUp() public {
        spend = new SpendVerifier();
        redeem = new RedeemVerifier();
    }

    function _load(string memory name) internal view returns (bytes memory proof, bytes32[] memory inputs) {
        string memory json = vm.readFile(string.concat("test/fixtures/", name, ".json"));
        proof = vm.parseJsonBytes(json, ".proof");
        inputs = vm.parseJsonBytes32Array(json, ".publicInputs");
    }

    function test_spendProofVerifies() public view {
        (bytes memory proof, bytes32[] memory inputs) = _load("bet_priya");
        assertTrue(spend.verify(proof, inputs));
    }

    function test_redeemProofVerifies() public view {
        (bytes memory proof, bytes32[] memory inputs) = _load("redeem_priya_win");
        assertTrue(redeem.verify(proof, inputs));
    }

    function test_spendRejectsTamperedRelayer() public {
        (bytes memory proof, bytes32[] memory inputs) = _load("bet_priya");
        inputs[9] = bytes32(uint256(uint160(address(0xBAD)))); // relayer
        vm.expectRevert();
        spend.verify(proof, inputs);
    }

    function test_redeemRejectsTamperedNum() public {
        (bytes memory proof, bytes32[] memory inputs) = _load("redeem_priya_win");
        inputs[6] = bytes32(uint256(inputs[6]) + 1); // num
        vm.expectRevert();
        redeem.verify(proof, inputs);
    }

    function test_redeemProofRejectedBySpendVerifier() public {
        (bytes memory proof, bytes32[] memory inputs) = _load("redeem_priya_win");
        vm.expectRevert();
        spend.verify(proof, inputs);
    }
}
