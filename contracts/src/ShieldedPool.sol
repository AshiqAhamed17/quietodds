// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoseidonT5} from "poseidon-solidity/PoseidonT5.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";
import {PoseidonMerkleTree} from "./PoseidonMerkleTree.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {Markets} from "./Markets.sol";

/// @title ShieldedPool
/// @notice The private balance behind QuietOdds. Users deposit once, then bet,
///         claim and withdraw with zero-knowledge proofs, so no bet, side or
///         payout can be linked to the depositor.
///
///         Every holding is a leaf in one Poseidon tree (see circuits/lib):
///           balance  = H(1, asset, amount, precommitment)
///           position = H(2, market, side, stake, precommitment)
///         The contract builds every leaf whose amount is public itself, so a
///         client can never mint value; leaves with hidden amounts (change,
///         payouts) are proven well-formed by the circuits.
contract ShieldedPool is PoseidonMerkleTree, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TAG_BALANCE = 1;
    uint256 public constant TAG_POSITION = 2;
    uint256 public constant TAG_TICKET = 3;

    uint256 public constant ASSET_USDC = 1;
    uint256 public constant ASSET_WETH = 2;

    uint256 public constant ACTION_WITHDRAW = 1;
    uint256 public constant ACTION_BET = 2;
    uint256 public constant ACTION_BATCH_JOIN = 3;

    /// Matches the circuits' range checks: balances are u128, stakes u96.
    uint256 internal constant MAX_AMOUNT = 2 ** 96 - 1;

    /// Public inputs of the `spend` circuit, in circuit order.
    struct SpendArgs {
        uint256 root;
        uint256 nullifierHash;
        uint256 asset;
        uint256 changeCommitment;
        uint256 publicAmount;
        uint256 actionType;
        uint256 actionParam1;
        uint256 actionParam2;
        uint256 outPrecommitment;
        address relayer;
        uint256 fee;
        address recipient;
    }

    /// Caller-supplied public inputs of the `redeem` circuit. The ratio, side
    /// rule and output asset are filled in from contract state.
    struct RedeemArgs {
        uint256 root;
        uint256 nullifierHash;
        uint256 kind;
        uint256 id;
        uint256 outCommitment;
        address relayer;
        uint256 fee;
    }

    IVerifier public immutable spendVerifier;
    IVerifier public immutable redeemVerifier;
    Markets public immutable markets;

    mapping(uint256 assetId => IERC20) public assets;
    mapping(uint256 nullifierHash => bool) public nullified;

    event Deposit(address indexed from, uint256 indexed asset, uint256 amount, uint256 leafIndex);
    event Spend(uint256 indexed nullifierHash, uint256 indexed actionType, uint256 asset, uint256 publicAmount);
    event Redeem(uint256 indexed nullifierHash, uint256 indexed kind, uint256 indexed id);
    event Withdrawal(address indexed recipient, uint256 indexed asset, uint256 amount);

    error UnknownAsset();
    error BadAmount();
    error UnknownRoot();
    error NullifierSpent();
    error WrongRelayer();
    error InvalidProof();
    error UnknownAction();
    error BetsAreUsdcOnly();
    error ZeroRecipient();
    error BadKind();

    constructor(IVerifier spendVerifier_, IVerifier redeemVerifier_, Markets markets_, IERC20 usdc, IERC20 weth) {
        spendVerifier = spendVerifier_;
        redeemVerifier = redeemVerifier_;
        markets = markets_;
        assets[ASSET_USDC] = usdc;
        assets[ASSET_WETH] = weth;
    }

    // --- deposit -------------------------------------------------------------

    /// @notice Shields `amount` of `asset` into a new private balance note.
    ///         Public: who deposited how much. Hidden: everything after.
    /// @param precommitment H(nullifier, secret), derived from the user's keys.
    /// @param ciphertext The note encrypted to the user's viewing key (backup).
    function deposit(uint256 asset, uint256 amount, uint256 precommitment, bytes calldata ciphertext)
        external
        nonReentrant
        returns (uint256 leafIndex)
    {
        IERC20 token = _token(asset);
        if (amount == 0 || amount > MAX_AMOUNT) revert BadAmount();
        if (precommitment >= SNARK_FIELD) revert NotInField();

        token.safeTransferFrom(msg.sender, address(this), amount);
        leafIndex = _insert(PoseidonT5.hash([TAG_BALANCE, asset, amount, precommitment]), ciphertext);
        emit Deposit(msg.sender, asset, amount, leafIndex);
    }

    // --- spend ---------------------------------------------------------------

    /// @notice Spends one balance note: a hidden change note goes back into the
    ///         tree and `publicAmount` is routed by the action. Usually sent by
    ///         a relayer, so the user's wallet never appears.
    /// @param changeCiphertext Backup of the change note for the owner.
    /// @param outCiphertext Backup of the action's output note (position), if any.
    function spend(
        SpendArgs calldata a,
        bytes calldata proof,
        bytes calldata changeCiphertext,
        bytes calldata outCiphertext
    ) external nonReentrant {
        IERC20 token = _token(a.asset);
        _checkNullifier(a.root, a.nullifierHash, a.relayer);
        if (a.publicAmount > MAX_AMOUNT || a.fee > MAX_AMOUNT) revert BadAmount();

        bytes32[] memory inputs = new bytes32[](12);
        inputs[0] = bytes32(a.root);
        inputs[1] = bytes32(a.nullifierHash);
        inputs[2] = bytes32(a.asset);
        inputs[3] = bytes32(a.changeCommitment);
        inputs[4] = bytes32(a.publicAmount);
        inputs[5] = bytes32(a.actionType);
        inputs[6] = bytes32(a.actionParam1);
        inputs[7] = bytes32(a.actionParam2);
        inputs[8] = bytes32(a.outPrecommitment);
        inputs[9] = bytes32(uint256(uint160(a.relayer)));
        inputs[10] = bytes32(a.fee);
        inputs[11] = bytes32(uint256(uint160(a.recipient)));
        _verify(spendVerifier, proof, inputs);

        nullified[a.nullifierHash] = true;
        _insert(a.changeCommitment, changeCiphertext);

        if (a.actionType == ACTION_WITHDRAW) {
            if (a.recipient == address(0)) revert ZeroRecipient();
            token.safeTransfer(a.recipient, a.publicAmount);
            emit Withdrawal(a.recipient, a.asset, a.publicAmount);
        } else if (a.actionType == ACTION_BET) {
            if (a.asset != ASSET_USDC) revert BetsAreUsdcOnly();
            if (a.publicAmount == 0 || a.actionParam2 >= markets.MAX_SIDES()) revert BadAmount();
            if (a.outPrecommitment >= SNARK_FIELD) revert NotInField();
            markets.addBet(a.actionParam1, uint8(a.actionParam2), a.publicAmount);
            _insert(
                PoseidonT6.hash([TAG_POSITION, a.actionParam1, a.actionParam2, a.publicAmount, a.outPrecommitment]),
                outCiphertext
            );
        } else {
            revert UnknownAction();
        }

        if (a.fee > 0) token.safeTransfer(msg.sender, a.fee);
        emit Spend(a.nullifierHash, a.actionType, a.asset, a.publicAmount);
    }

    // --- redeem --------------------------------------------------------------

    /// @notice Turns a winning (or refunded) position into a hidden balance
    ///         note. The payout ratio comes from Markets, never from the caller,
    ///         so a losing position cannot produce a valid proof.
    function redeem(RedeemArgs calldata a, bytes calldata proof, bytes calldata outCiphertext) external nonReentrant {
        _checkNullifier(a.root, a.nullifierHash, a.relayer);
        if (a.fee > MAX_AMOUNT) revert BadAmount();

        uint256 num;
        uint256 den;
        uint256 requiredSide;
        bool anySide;
        uint256 assetOut;
        if (a.kind == TAG_POSITION) {
            uint8 side;
            (num, den, side, anySide) = markets.redeemTerms(a.id);
            requiredSide = side;
            assetOut = ASSET_USDC;
        } else {
            revert BadKind();
        }

        bytes32[] memory inputs = new bytes32[](12);
        inputs[0] = bytes32(a.root);
        inputs[1] = bytes32(a.nullifierHash);
        inputs[2] = bytes32(a.kind);
        inputs[3] = bytes32(a.id);
        inputs[4] = bytes32(requiredSide);
        inputs[5] = bytes32(anySide ? uint256(1) : 0);
        inputs[6] = bytes32(num);
        inputs[7] = bytes32(den);
        inputs[8] = bytes32(assetOut);
        inputs[9] = bytes32(a.outCommitment);
        inputs[10] = bytes32(uint256(uint160(a.relayer)));
        inputs[11] = bytes32(a.fee);
        _verify(redeemVerifier, proof, inputs);

        nullified[a.nullifierHash] = true;
        _insert(a.outCommitment, outCiphertext);
        if (a.fee > 0) _token(assetOut).safeTransfer(msg.sender, a.fee);
        emit Redeem(a.nullifierHash, a.kind, a.id);
    }

    // --- internals -----------------------------------------------------------

    function _token(uint256 asset) internal view returns (IERC20 token) {
        token = assets[asset];
        if (address(token) == address(0)) revert UnknownAsset();
    }

    /// @dev `relayer == 0` lets anyone submit (self-relay); otherwise only the
    ///      named relayer can, so a front-runner cannot steal its fee.
    function _checkNullifier(uint256 root, uint256 nullifierHash, address relayer) internal view {
        if (!isKnownRoot(root)) revert UnknownRoot();
        if (nullified[nullifierHash]) revert NullifierSpent();
        if (relayer != address(0) && relayer != msg.sender) revert WrongRelayer();
    }

    function _verify(IVerifier verifier, bytes calldata proof, bytes32[] memory inputs) internal view {
        for (uint256 i = 0; i < inputs.length; i++) {
            if (uint256(inputs[i]) >= SNARK_FIELD) revert NotInField();
        }
        // The generated verifiers revert on a bad proof; treat `false` the same.
        try verifier.verify(proof, inputs) returns (bool ok) {
            if (!ok) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
    }
}
