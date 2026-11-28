// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolVaultV2} from "../../src/interfaces/IPoolVaultV2.sol";

/// Stands in for Privacy Pools v2's PoolVault with the same rules that matter to
/// a processor: `processor == msg.sender`, the proof's context must equal
/// keccak256(abi.encode(params, noteData)) % SNARK_FIELD, and the payout goes
/// to `msg.sender`. The "proof" is just the context in pubSignals[0][0].
contract MockPoolVault is IPoolVaultV2 {
    uint256 internal constant SNARK_FIELD =
        21888242871839275222246405745257275088548364400416034343696050416308114819009;

    IERC20 public payToken;
    uint256 public payAmount;
    /// Optional call made during `transact`, to test reentrancy.
    address public hookTarget;
    bytes public hookCall;

    error NotProcessor();
    error BadContext();

    function setPayout(IERC20 token, uint256 amount) external {
        payToken = token;
        payAmount = amount;
    }

    function setHook(address target, bytes calldata call) external {
        hookTarget = target;
        hookCall = call;
    }

    /// The context a real proof would commit to for these params.
    function contextOf(TransactParams memory params, NoteData[] memory noteData) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(params, noteData))) % SNARK_FIELD;
    }

    function transact(TransactProof calldata proof, TransactParams calldata params, NoteData[] calldata noteData)
        external
    {
        if (params.processor != msg.sender) revert NotProcessor();
        if (proof.pubSignals[0][0] != contextOf(params, noteData)) revert BadContext();
        if (hookTarget != address(0)) {
            (bool ok, bytes memory ret) = hookTarget.call(hookCall);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        payToken.transfer(msg.sender, payAmount);
    }
}
