// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonMerkleTree} from "../src/PoseidonMerkleTree.sol";

contract TreeHarness is PoseidonMerkleTree {
    function insertWith(uint256 leaf, bytes calldata ciphertext) external returns (uint256) {
        return _insert(leaf, ciphertext);
    }

    function insert(uint256 leaf) external returns (uint256) {
        return this.insertWith(leaf, "");
    }
}

contract PoseidonMerkleTreeTest is Test {
    TreeHarness tree;

    function setUp() public {
        tree = new TreeHarness();
    }

    function test_zerosChain() public view {
        for (uint256 i = 1; i <= 20; i++) {
            assertEq(tree.zeros(i), PoseidonT3.hash([tree.zeros(i - 1), tree.zeros(i - 1)]));
        }
    }

    function test_emptyRootIsZeroSubtree() public view {
        assertEq(tree.getLastRoot(), tree.zeros(20));
    }

    function test_rootMatchesJsTree() public {
        tree.insert(1);
        tree.insert(2);
        tree.insert(3);
        // merkleRoot([1, 2, 3]) from scripts/lib/merkle.mjs
        assertEq(tree.getLastRoot(), 0x2483316ece47e1b749c99d144d80bd18122eae426205d8319bddd189ddd999d0);
    }

    function test_rootMatchesProofFixture() public {
        // Inserting the fixture's deposit leaf reproduces the root the spend proof was built on.
        string memory json = vm.readFile("test/fixtures/spend_bet.json");
        tree.insert(vm.parseJsonUint(json, ".ctx.depositLeaf"));
        assertEq(bytes32(tree.getLastRoot()), vm.parseJsonBytes32Array(json, ".publicInputs")[0]);
    }

    function test_rootHistory() public {
        uint256 first = tree.getLastRoot();
        tree.insert(7);
        uint256 second = tree.getLastRoot();
        assertTrue(tree.isKnownRoot(first));
        assertTrue(tree.isKnownRoot(second));
        assertFalse(tree.isKnownRoot(0));
        assertFalse(tree.isKnownRoot(123));
    }

    function test_oldRootsExpire() public {
        tree.insert(1);
        uint256 old = tree.getLastRoot();
        for (uint256 i = 0; i < 64; i++) {
            tree.insert(i + 10);
        }
        assertFalse(tree.isKnownRoot(old));
    }

    function test_rejectsLeafOutsideField() public {
        vm.expectRevert(PoseidonMerkleTree.NotInField.selector);
        tree.insert(type(uint256).max);
    }

    function test_insertGas() public {
        tree.insert(1);
        uint256 g = gasleft();
        tree.insert(2);
        emit log_named_uint("gas per insert", g - gasleft());
    }
}
