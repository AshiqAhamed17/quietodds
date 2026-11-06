// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Markets} from "../src/Markets.sol";
import {ResolverReceiver} from "../src/ResolverReceiver.sol";
import {BatchSwapper} from "../src/BatchSwapper.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";

/// Records the calls the receiver makes; batch 7 is "not ready".
contract MockBatches {
    uint256[] public executed;
    uint256 public donations;

    function executeBatch(uint256 batchId) external returns (uint256) {
        require(batchId != 7, "IntervalNotOver");
        executed.push(batchId);
        return 1;
    }

    function donateFees() external returns (uint256) {
        donations++;
        return 1;
    }

    function executedCount() external view returns (uint256) {
        return executed.length;
    }
}

contract ResolverReceiverTest is Test {
    MockBatches mockBatches = new MockBatches();
    Markets markets;
    ResolverReceiver receiver;
    address forwarder = makeAddr("forwarder");
    address pool = makeAddr("pool");
    address workflowOwner = makeAddr("workflowOwner");
    uint64 closeTime;

    function setUp() public {
        vm.warp(1_800_000_000);
        markets = new Markets(address(this));
        receiver = new ResolverReceiver(address(this), markets, BatchSwapper(payable(address(mockBatches))), forwarder);
        markets.setPool(pool);
        markets.setResolver(address(receiver));
        closeTime = uint64(block.timestamp + 1 hours);
        for (uint256 i = 0; i < 3; i++) {
            markets.createMarket("m", "Yes|No", 2, closeTime, Markets.Source.Sports, "", address(0), 0);
            vm.prank(pool);
            markets.addBet(i + 1, 0, 1e6);
        }
    }

    function _metadata(address owner_) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), bytes10("quietodds"), owner_);
    }

    function _report(uint8 kind, uint256 id, uint8 outcome) internal pure returns (bytes memory) {
        ResolverReceiver.Action[] memory a = new ResolverReceiver.Action[](1);
        a[0] = ResolverReceiver.Action(kind, id, outcome);
        return abi.encode(a);
    }

    function test_resolvesThroughForwarder() public {
        vm.warp(closeTime);
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), _report(1, 1, 0));
        assertEq(uint8(markets.getMarket(1).status), uint8(Markets.Status.Resolved));
    }

    function test_cancelsThroughForwarder() public {
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), _report(2, 1, 0));
        assertEq(uint8(markets.getMarket(1).status), uint8(Markets.Status.Cancelled));
    }

    function test_rejectsNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(ResolverReceiver.UnauthorizedForwarder.selector, address(this)));
        receiver.onReport(_metadata(workflowOwner), _report(1, 1, 0));
    }

    function test_rejectsForeignWorkflow() public {
        receiver.setExpectedWorkflowOwner(workflowOwner);
        address stranger = makeAddr("stranger");
        vm.warp(closeTime);
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ResolverReceiver.UnauthorizedWorkflow.selector, stranger));
        receiver.onReport(_metadata(stranger), _report(1, 1, 0));

        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), _report(1, 1, 0));
        assertEq(uint8(markets.getMarket(1).status), uint8(Markets.Status.Resolved));
    }

    function test_batchSkipsFailedActions() public {
        vm.warp(closeTime);
        ResolverReceiver.Action[] memory a = new ResolverReceiver.Action[](3);
        a[0] = ResolverReceiver.Action(1, 1, 0);
        a[1] = ResolverReceiver.Action(1, 1, 1); // already resolved -> fails, logged
        a[2] = ResolverReceiver.Action(2, 3, 0);
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), abi.encode(a));
        assertEq(uint8(markets.getMarket(1).status), uint8(Markets.Status.Resolved));
        assertEq(markets.getMarket(1).winningSide, 0);
        assertEq(uint8(markets.getMarket(3).status), uint8(Markets.Status.Cancelled));
    }

    function test_executesBatchesAndDonatesInOneReport() public {
        vm.warp(closeTime);
        ResolverReceiver.Action[] memory a = new ResolverReceiver.Action[](4);
        a[0] = ResolverReceiver.Action(1, 1, 0); // resolve first, so its fee accrues
        a[1] = ResolverReceiver.Action(3, 5, 0);
        a[2] = ResolverReceiver.Action(3, 7, 0); // not ready -> logged, the rest still run
        a[3] = ResolverReceiver.Action(4, 0, 0);
        vm.expectEmit(true, true, false, false, address(receiver));
        emit ResolverReceiver.ActionFailed(3, 7, "");
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), abi.encode(a));
        assertEq(uint8(markets.getMarket(1).status), uint8(Markets.Status.Resolved));
        assertEq(mockBatches.executedCount(), 1);
        assertEq(mockBatches.executed(0), 5);
        assertEq(mockBatches.donations(), 1);
    }

    function test_resolveBeforeCloseIsLoggedNotApplied() public {
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), _report(1, 1, 0));
        assertEq(uint8(markets.getMarket(1).status), uint8(Markets.Status.Open));
    }

    function test_onlyOwnerConfigures() public {
        vm.startPrank(makeAddr("rando"));
        vm.expectRevert();
        receiver.setForwarder(address(1));
        vm.expectRevert();
        receiver.setExpectedWorkflowOwner(address(1));
        vm.stopPrank();
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
    }
}
