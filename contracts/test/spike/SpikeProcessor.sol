// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Phase 1.1 spike only, never deployed to mainnet: proves that a contract can be the
/// Privacy Pools v2 `transact` processor with QuietOdds' own `data`. It receives the
/// withdrawn tokens and sends them straight back to its owner.
interface IPoolVaultV2 {
    struct TransactProof {
        uint256[2] pA;
        uint256[2][2] pB;
        uint256[2] pC;
        uint256[][] pubSignals;
    }

    struct TransactParams {
        address processor;
        bytes data;
    }

    struct NoteData {
        bytes32 hint;
        bytes data;
    }

    function transact(TransactProof calldata proof, TransactParams calldata params, NoteData[] calldata noteData) external;
}

contract SpikeProcessor {
    IPoolVaultV2 public immutable vault;
    IERC20 public immutable token;
    address public immutable owner;

    event Funded(bytes32 precommitment, bytes ciphertext, address relayer, uint256 fee, uint256 received);

    constructor(IPoolVaultV2 vault_, IERC20 token_, address owner_) {
        vault = vault_;
        token = token_;
        owner = owner_;
    }

    /// `data` = abi.encode(precommitment, ciphertext, relayer, fee): what the real depositor
    /// will decode. The proof binds it, so nobody can swap it for their own.
    function fund(IPoolVaultV2.TransactProof calldata proof, bytes calldata data, IPoolVaultV2.NoteData[] calldata noteData)
        external
    {
        (bytes32 precommitment, bytes memory ciphertext, address relayer, uint256 fee) =
            abi.decode(data, (bytes32, bytes, address, uint256));
        uint256 before = token.balanceOf(address(this));
        vault.transact(proof, IPoolVaultV2.TransactParams(address(this), data), noteData);
        uint256 received = token.balanceOf(address(this)) - before;
        require(token.transfer(owner, received), "return failed");
        emit Funded(precommitment, ciphertext, relayer, fee, received);
    }
}
