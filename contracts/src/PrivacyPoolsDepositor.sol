// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolVaultV2} from "./interfaces/IPoolVaultV2.sol";
import {ShieldedPool} from "./ShieldedPool.sol";

/// @title PrivacyPoolsDepositor
/// @notice Moves USDC from a Privacy Pools v2 note straight into a private
///         QuietOdds balance in one transaction. This contract is the
///         `processor` of the PoolVault `transact`; the proof binds `data`, so
///         nobody can change the new note, the relayer or the fee.
///         Public: that some Privacy Pools note paid in, and the amount.
///         Hidden: which note, and who owns the QuietOdds balance.
/// @dev Holds no funds between calls and has no admin.
contract PrivacyPoolsDepositor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolVaultV2 public immutable poolVault;
    ShieldedPool public immutable shieldedPool;
    IERC20 public immutable usdc;

    event FundedFromPrivacyPools(uint256 indexed leafIndex, uint256 received, uint256 fee, address relayer);

    error WrongRelayer();
    error FeeTooHigh();

    constructor(IPoolVaultV2 poolVault_, ShieldedPool shieldedPool_) {
        poolVault = poolVault_;
        shieldedPool = shieldedPool_;
        usdc = shieldedPool_.assets(shieldedPool_.ASSET_USDC());
        usdc.forceApprove(address(shieldedPool_), type(uint256).max);
    }

    /// @param data abi.encode(uint256 precommitment, bytes ciphertext, address relayer, uint256 fee).
    ///        `relayer` must be the sender, or zero with no fee when the user submits it themselves.
    /// @return leafIndex The new balance note's position in the QuietOdds tree.
    function fund(
        IPoolVaultV2.TransactProof calldata proof,
        bytes calldata data,
        IPoolVaultV2.NoteData[] calldata noteData
    ) external nonReentrant returns (uint256 leafIndex) {
        (uint256 precommitment, bytes memory ciphertext, address relayer, uint256 fee) =
            abi.decode(data, (uint256, bytes, address, uint256));
        if (relayer == address(0) ? fee != 0 : relayer != msg.sender) revert WrongRelayer();

        uint256 before = usdc.balanceOf(address(this));
        poolVault.transact(proof, IPoolVaultV2.TransactParams(address(this), data), noteData);
        // A note in any other token pays nothing here and reverts below.
        uint256 received = usdc.balanceOf(address(this)) - before;
        if (received <= fee) revert FeeTooHigh();

        if (fee > 0) usdc.safeTransfer(relayer, fee);
        leafIndex = shieldedPool.deposit(shieldedPool.ASSET_USDC(), received - fee, precommitment, ciphertext);
        emit FundedFromPrivacyPools(leafIndex, received, fee, relayer);
    }
}
