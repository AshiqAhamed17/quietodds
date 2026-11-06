// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {Markets} from "./Markets.sol";
import {BatchSwapper} from "./BatchSwapper.sol";

/// @title ResolverReceiver
/// @notice Landing pad for the QuietOdds Chainlink CRE workflow. The workflow
///         reads open markets, fetches results (sports API or Chainlink feed)
///         under DON consensus, and delivers a signed report here through the
///         KeystoneForwarder. No one on the team decides a result.
/// @dev    Report = abi.encode(Action[]). One report can settle many markets;
///         each action runs in its own try/catch so one stale action (e.g. an
///         already-resolved market) cannot block the rest.
contract ResolverReceiver is IReceiver, Ownable {
    uint8 public constant KIND_RESOLVE = 1;
    uint8 public constant KIND_CANCEL = 2;
    uint8 public constant KIND_EXECUTE_BATCH = 3; // id = batch id
    uint8 public constant KIND_DONATE_FEES = 4; // donate accrued market fees to LPs

    struct Action {
        uint8 kind;
        uint256 id;
        uint8 outcome;
    }

    Markets public immutable markets;
    BatchSwapper public immutable batches;
    /// KeystoneForwarder (production) or MockKeystoneForwarder (simulation).
    address public forwarder;
    /// If set, only reports from workflows owned by this address are accepted.
    /// The forwarder relays any workflow's reports, so this pins ours.
    address public expectedWorkflowOwner;

    event ActionApplied(uint8 indexed kind, uint256 indexed id, uint8 outcome);
    event ActionFailed(uint8 indexed kind, uint256 indexed id, bytes reason);
    event ForwarderSet(address forwarder);
    event WorkflowOwnerSet(address workflowOwner);

    error UnauthorizedForwarder(address caller);
    error UnauthorizedWorkflow(address workflowOwner);

    constructor(address owner_, Markets markets_, BatchSwapper batches_, address forwarder_) Ownable(owner_) {
        markets = markets_;
        batches = batches_;
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function setExpectedWorkflowOwner(address workflowOwner) external onlyOwner {
        expectedWorkflowOwner = workflowOwner;
        emit WorkflowOwnerSet(workflowOwner);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        if (expectedWorkflowOwner != address(0)) {
            address workflowOwner = _workflowOwner(metadata);
            if (workflowOwner != expectedWorkflowOwner) revert UnauthorizedWorkflow(workflowOwner);
        }

        Action[] memory actions = abi.decode(report, (Action[]));
        for (uint256 i = 0; i < actions.length; i++) {
            _apply(actions[i]);
        }
    }

    function _apply(Action memory a) internal {
        if (a.kind == KIND_RESOLVE) {
            try markets.resolve(a.id, a.outcome) {
                emit ActionApplied(a.kind, a.id, a.outcome);
            } catch (bytes memory reason) {
                emit ActionFailed(a.kind, a.id, reason);
            }
        } else if (a.kind == KIND_CANCEL) {
            try markets.cancel(a.id) {
                emit ActionApplied(a.kind, a.id, 0);
            } catch (bytes memory reason) {
                emit ActionFailed(a.kind, a.id, reason);
            }
        } else if (a.kind == KIND_EXECUTE_BATCH) {
            try batches.executeBatch(a.id) {
                emit ActionApplied(a.kind, a.id, 0);
            } catch (bytes memory reason) {
                emit ActionFailed(a.kind, a.id, reason);
            }
        } else if (a.kind == KIND_DONATE_FEES) {
            try batches.donateFees() {
                emit ActionApplied(a.kind, 0, 0);
            } catch (bytes memory reason) {
                emit ActionFailed(a.kind, 0, reason);
            }
        } else {
            emit ActionFailed(a.kind, a.id, "unknown kind");
        }
    }

    /// @dev Forwarder metadata is abi.encodePacked(bytes32 workflowId,
    ///      bytes10 workflowName, address workflowOwner). Layout from the
    ///      Chainlink CRE "Building Consumer Contracts" guide.
    function _workflowOwner(bytes memory metadata) internal pure returns (address workflowOwner) {
        if (metadata.length < 62) return address(0);
        assembly {
            workflowOwner := shr(96, mload(add(metadata, 74)))
        }
    }
}
