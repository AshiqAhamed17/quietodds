// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Interface of the bb-generated UltraHonk verifiers.
interface IVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
