// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @title PoseidonMerkleTree
/// @notice Append-only, fixed-depth Poseidon Merkle tree of note leaves.
///         Matches circuits/lib/src/merkle.nr and scripts/lib/merkle.mjs:
///         empty leaves are 0, parents are Poseidon(left, right), and a missing
///         right node is the zero-subtree hash for its level.
/// @dev    Keeps the last ROOT_HISTORY roots so a proof built against a
///         slightly older root still verifies after new leaves land.
abstract contract PoseidonMerkleTree {
    uint256 public constant DEPTH = 20;
    uint32 public constant ROOT_HISTORY = 64;
    uint256 internal constant SNARK_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256[DEPTH] internal filledSubtrees;
    uint256[ROOT_HISTORY] public roots;
    uint32 public currentRootIndex;
    uint32 public nextLeafIndex;

    event LeafInserted(uint256 indexed index, uint256 leaf, bytes ciphertext);

    error TreeFull();
    error NotInField();

    constructor() {
        roots[0] = zeros(DEPTH);
    }

    /// @notice Appends `leaf` and emits it with the owner's encrypted note
    ///         backup, so wallets can rebuild the tree and recover notes.
    function _insert(uint256 leaf, bytes calldata ciphertext) internal returns (uint256 index) {
        if (leaf >= SNARK_FIELD) revert NotInField();
        index = nextLeafIndex;
        if (index >= 2 ** DEPTH) revert TreeFull();

        uint256 node = leaf;
        uint256 idx = index;
        for (uint256 i = 0; i < DEPTH; i++) {
            if (idx & 1 == 0) {
                filledSubtrees[i] = node;
                node = PoseidonT3.hash([node, zeros(i)]);
            } else {
                node = PoseidonT3.hash([filledSubtrees[i], node]);
            }
            idx >>= 1;
        }

        uint32 next = (currentRootIndex + 1) % ROOT_HISTORY;
        currentRootIndex = next;
        roots[next] = node;
        nextLeafIndex = uint32(index + 1);
        emit LeafInserted(index, leaf, ciphertext);
    }

    function getLastRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }

    /// @notice True if `root` is one of the last ROOT_HISTORY roots.
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 i = currentRootIndex;
        do {
            if (roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY - 1 : i - 1;
        } while (i != currentRootIndex);
        return false;
    }

    /// @notice Root of an all-empty subtree of height `i` (zeros(0) = 0).
    ///         Generated from scripts/lib/merkle.mjs.
    function zeros(uint256 i) public pure returns (uint256) {
        if (i == 0) return 0x0000000000000000000000000000000000000000000000000000000000000000;
        if (i == 1) return 0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864;
        if (i == 2) return 0x1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1;
        if (i == 3) return 0x18f43331537ee2af2e3d758d50f72106467c6eea50371dd528d57eb2b856d238;
        if (i == 4) return 0x07f9d837cb17b0d36320ffe93ba52345f1b728571a568265caac97559dbc952a;
        if (i == 5) return 0x2b94cf5e8746b3f5c9631f4c5df32907a699c58c94b2ad4d7b5cec1639183f55;
        if (i == 6) return 0x2dee93c5a666459646ea7d22cca9e1bcfed71e6951b953611d11dda32ea09d78;
        if (i == 7) return 0x078295e5a22b84e982cf601eb639597b8b0515a88cb5ac7fa8a4aabe3c87349d;
        if (i == 8) return 0x2fa5e5f18f6027a6501bec864564472a616b2e274a41211a444cbe3a99f3cc61;
        if (i == 9) return 0x0e884376d0d8fd21ecb780389e941f66e45e7acce3e228ab3e2156a614fcd747;
        if (i == 10) return 0x1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2;
        if (i == 11) return 0x1f8d8822725e36385200c0b201249819a6e6e1e4650808b5bebc6bface7d7636;
        if (i == 12) return 0x2c5d82f66c914bafb9701589ba8cfcfb6162b0a12acf88a8d0879a0471b5f85a;
        if (i == 13) return 0x14c54148a0940bb820957f5adf3fa1134ef5c4aaa113f4646458f270e0bfbfd0;
        if (i == 14) return 0x190d33b12f986f961e10c0ee44d8b9af11be25588cad89d416118e4bf4ebe80c;
        if (i == 15) return 0x22f98aa9ce704152ac17354914ad73ed1167ae6596af510aa5b3649325e06c92;
        if (i == 16) return 0x2a7c7c9b6ce5880b9f6f228d72bf6a575a526f29c66ecceef8b753d38bba7323;
        if (i == 17) return 0x2e8186e558698ec1c67af9c14d463ffc470043c9c2988b954d75dd643f36b992;
        if (i == 18) return 0x0f57c5571e9a4eab49e2c8cf050dae948aef6ead647392273546249d1c1ff10f;
        if (i == 19) return 0x1830ee67b5fb554ad5f63d4388800e1cfe78e310697d46e43c9ce36134f72cca;
        if (i == 20) return 0x2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e;
        revert("zeros: out of range");
    }
}
