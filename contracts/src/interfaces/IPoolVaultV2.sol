// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// The part of Privacy Pools v2's PoolVault (0xbow) that QuietOdds calls.
/// `transact` requires `params.processor == msg.sender`, binds
/// keccak256(abi.encode(params, noteData)) into the proof's context and pays
/// the withdrawn amount to `msg.sender`. There is no callback.
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

    function transact(TransactProof calldata proof, TransactParams calldata params, NoteData[] calldata noteData)
        external;
}
