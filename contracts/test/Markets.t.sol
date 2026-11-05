// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Markets} from "../src/Markets.sol";
import {MockFeed} from "./mocks/MockFeed.sol";

contract MarketsTest is Test {
    Markets markets;
    MockFeed feed;
    address owner = address(this);
    address pool = makeAddr("pool");
    address resolver = makeAddr("resolver");
    uint64 closeTime;

    function setUp() public {
        vm.warp(1_800_000_000);
        markets = new Markets(owner);
        markets.setPool(pool);
        markets.setResolver(resolver);
        feed = new MockFeed();
        closeTime = uint64(block.timestamp + 1 hours);
    }

    function _sports() internal returns (uint256) {
        return markets.createMarket(
            "India vs Australia", "India|Australia", 2, closeTime, Markets.Source.Sports, "espn:1", address(0), 0
        );
    }

    function _price() internal returns (uint256) {
        return
            markets.createMarket(
                "ETH > $2500?", "No|Yes", 2, closeTime, Markets.Source.Price, "", address(feed), 2500e8
            );
    }

    function test_createAndBet() public {
        uint256 id = _sports();
        assertEq(id, 1);
        vm.startPrank(pool);
        markets.addBet(id, 0, 70e6);
        markets.addBet(id, 1, 130e6);
        vm.stopPrank();
        uint256[] memory t = markets.getSideTotals(id);
        assertEq(t[0], 70e6);
        assertEq(t[1], 130e6);
        assertEq(markets.getMarket(id).pot, 200e6);
        assertTrue(markets.isOpen(id));
    }

    function test_onlyOwnerCreates() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        markets.createMarket("x", "Yes|No", 2, closeTime, Markets.Source.Sports, "", address(0), 0);
    }

    function test_onlyPoolBets() public {
        uint256 id = _sports();
        vm.expectRevert(Markets.NotPool.selector);
        markets.addBet(id, 0, 1);
    }

    function test_poolSetOnce() public {
        vm.expectRevert(Markets.PoolAlreadySet.selector);
        markets.setPool(address(1));
    }

    function test_noBetAfterClose() public {
        uint256 id = _sports();
        vm.warp(closeTime);
        vm.prank(pool);
        vm.expectRevert(Markets.MarketClosed.selector);
        markets.addBet(id, 0, 1);
    }

    function test_noBetOnBadSide() public {
        uint256 id = _sports();
        vm.prank(pool);
        vm.expectRevert(Markets.SideOutOfRange.selector);
        markets.addBet(id, 2, 1);
    }

    function test_resolveWinAndTerms() public {
        uint256 id = _sports();
        vm.startPrank(pool);
        markets.addBet(id, 0, 70e6);
        markets.addBet(id, 1, 130e6);
        vm.stopPrank();

        vm.expectRevert(Markets.NotFinal.selector);
        markets.redeemTerms(id);

        vm.prank(resolver);
        vm.expectRevert(Markets.MarketStillOpen.selector);
        markets.resolve(id, 0);

        vm.warp(closeTime);
        vm.prank(resolver);
        markets.resolve(id, 0);

        (uint256 num, uint256 den, uint8 side, bool anySide) = markets.redeemTerms(id);
        assertEq(num, 198e6); // 200 - 1% fee
        assertEq(den, 70e6);
        assertEq(side, 0);
        assertFalse(anySide);
        assertEq(markets.feesAccrued(), 2e6);

        vm.prank(pool);
        assertEq(markets.takeFees(), 2e6);
        assertEq(markets.feesAccrued(), 0);
    }

    function test_onlyResolverResolves() public {
        uint256 id = _sports();
        vm.warp(closeTime);
        vm.expectRevert(Markets.NotResolver.selector);
        markets.resolve(id, 0);
    }

    function test_cannotResolveTwice() public {
        uint256 id = _sports();
        vm.prank(pool);
        markets.addBet(id, 0, 1e6);
        vm.warp(closeTime);
        vm.startPrank(resolver);
        markets.resolve(id, 0);
        vm.expectRevert(Markets.MarketNotOpen.selector);
        markets.resolve(id, 1);
        vm.stopPrank();
    }

    function test_emptyWinningSideRefunds() public {
        uint256 id = _sports();
        vm.prank(pool);
        markets.addBet(id, 1, 50e6);
        vm.warp(closeTime);
        vm.prank(resolver);
        markets.resolve(id, 0);
        assertEq(uint8(markets.getMarket(id).status), uint8(Markets.Status.Cancelled));
        (uint256 num, uint256 den,, bool anySide) = markets.redeemTerms(id);
        assertEq(num, 1);
        assertEq(den, 1);
        assertTrue(anySide);
        assertEq(markets.feesAccrued(), 0);
    }

    function test_resolverCancel() public {
        uint256 id = _sports();
        vm.prank(resolver);
        markets.cancel(id);
        (,,, bool anySide) = markets.redeemTerms(id);
        assertTrue(anySide);
    }

    function test_cancelStaleAfterGrace() public {
        uint256 id = _sports();
        vm.warp(closeTime + 1 days - 1);
        vm.expectRevert(Markets.GraceNotOver.selector);
        markets.cancelStale(id);
        vm.warp(closeTime + 1 days);
        markets.cancelStale(id);
        assertEq(uint8(markets.getMarket(id).status), uint8(Markets.Status.Cancelled));
    }

    function test_resolveFromFeedYes() public {
        uint256 id = _price();
        vm.startPrank(pool);
        markets.addBet(id, 0, 10e6);
        markets.addBet(id, 1, 10e6);
        vm.stopPrank();
        vm.warp(closeTime + 10);
        feed.set(2600e8, closeTime + 5);
        markets.resolveFromFeed(id);
        assertEq(markets.getMarket(id).winningSide, 1);
    }

    function test_resolveFromFeedNo() public {
        uint256 id = _price();
        vm.startPrank(pool);
        markets.addBet(id, 0, 10e6);
        markets.addBet(id, 1, 10e6);
        vm.stopPrank();
        vm.warp(closeTime + 10);
        feed.set(2400e8, closeTime + 5);
        markets.resolveFromFeed(id);
        assertEq(markets.getMarket(id).winningSide, 0);
    }

    function test_feedPriceFromBeforeCloseRejected() public {
        uint256 id = _price();
        vm.warp(closeTime + 10);
        feed.set(2600e8, closeTime - 1);
        vm.expectRevert(Markets.StalePrice.selector);
        markets.resolveFromFeed(id);
    }

    function test_staleFeedRejected() public {
        uint256 id = _price();
        feed.set(2600e8, closeTime + 1);
        vm.warp(closeTime + 3 hours);
        vm.expectRevert(Markets.StalePrice.selector);
        markets.resolveFromFeed(id);
    }

    function test_sportsMarketCannotUseFeed() public {
        uint256 id = _sports();
        vm.expectRevert(Markets.NotPriceMarket.selector);
        markets.resolveFromFeed(id);
    }
}
