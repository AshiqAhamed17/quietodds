// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Markets} from "../src/Markets.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {SpendVerifier} from "../src/verifiers/SpendVerifier.sol";
import {RedeemVerifier} from "../src/verifiers/RedeemVerifier.sol";

contract TestToken is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory n, uint8 d) ERC20(n, n) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Replays the story from scripts/gen-fixtures.mjs on-chain with real proofs.
contract ShieldedPoolTest is Test {
    ShieldedPool pool;
    Markets markets;
    TestToken usdc;
    TestToken weth;

    address relayer = address(0xbeef);
    address recipient = address(0xcafe);
    address resolver = makeAddr("resolver");
    address priya = makeAddr("priya");
    address arjun = makeAddr("arjun");
    uint64 closeTime;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new TestToken("USDC", 6);
        weth = new TestToken("WETH", 18);
        markets = new Markets(address(this));
        pool = new ShieldedPool(
            IVerifier(address(new SpendVerifier())),
            IVerifier(address(new RedeemVerifier())),
            markets,
            IERC20(address(usdc)),
            IERC20(address(weth))
        );
        markets.setPool(address(pool));
        markets.setResolver(resolver);
        closeTime = uint64(block.timestamp + 1 hours);
        markets.createMarket("India vs Australia", 2, closeTime, Markets.Source.Sports, "espn:1", address(0), 0);

        usdc.mint(priya, 100e6);
        usdc.mint(arjun, 100e6);
    }

    // --- fixture helpers -----------------------------------------------------

    function _fixture(string memory name) internal view returns (bytes memory proof, bytes32[] memory pi) {
        string memory json = vm.readFile(string.concat("test/fixtures/", name, ".json"));
        proof = vm.parseJsonBytes(json, ".proof");
        pi = vm.parseJsonBytes32Array(json, ".publicInputs");
    }

    function _spendArgs(bytes32[] memory pi) internal pure returns (ShieldedPool.SpendArgs memory a) {
        a.root = uint256(pi[0]);
        a.nullifierHash = uint256(pi[1]);
        a.asset = uint256(pi[2]);
        a.changeCommitment = uint256(pi[3]);
        a.publicAmount = uint256(pi[4]);
        a.actionType = uint256(pi[5]);
        a.actionParam1 = uint256(pi[6]);
        a.actionParam2 = uint256(pi[7]);
        a.outPrecommitment = uint256(pi[8]);
        a.relayer = address(uint160(uint256(pi[9])));
        a.fee = uint256(pi[10]);
        a.recipient = address(uint160(uint256(pi[11])));
    }


    function _deposit(address who, string memory key) internal {
        string memory story = vm.readFile("test/fixtures/story.json");
        uint256 pc = vm.parseJsonUint(story, key);
        vm.startPrank(who);
        usdc.approve(address(pool), 100e6);
        pool.deposit(1, 100e6, pc, hex"aa");
        vm.stopPrank();
    }

    function _spend(string memory name) internal {
        (bytes memory proof, bytes32[] memory pi) = _fixture(name);
        vm.prank(relayer);
        pool.spend(_spendArgs(pi), proof, hex"bb", hex"cc");
    }


    function _bothBet() internal {
        _deposit(priya, ".priyaDepositPrecommitment");
        _spend("bet_priya");
        _deposit(arjun, ".arjunDepositPrecommitment");
        _spend("bet_arjun");
    }

    // --- deposit -------------------------------------------------------------

    function test_depositBuildsLeafOnChain() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        (, bytes32[] memory pi) = _fixture("bet_priya");
        assertEq(pool.getLastRoot(), uint256(pi[0]));
        assertEq(usdc.balanceOf(address(pool)), 100e6);
        assertEq(pool.nextLeafIndex(), 1);
    }

    function test_depositRejectsUnknownAssetAndZero() public {
        vm.startPrank(priya);
        usdc.approve(address(pool), 100e6);
        vm.expectRevert(ShieldedPool.UnknownAsset.selector);
        pool.deposit(9, 1e6, 1, "");
        vm.expectRevert(ShieldedPool.BadAmount.selector);
        pool.deposit(1, 0, 1, "");
        vm.stopPrank();
    }

    // --- spend: bet ----------------------------------------------------------

    function test_privateBet() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        _spend("bet_priya");

        uint256[] memory totals = markets.getSideTotals(1);
        assertEq(totals[0], 50e6);
        assertEq(usdc.balanceOf(relayer), 1e6);
        assertEq(usdc.balanceOf(address(pool)), 99e6);
        // change leaf then position leaf, exactly as the fixtures expect
        assertEq(pool.nextLeafIndex(), 3);
        (, bytes32[] memory pi) = _fixture("bet_arjun");
        _deposit(arjun, ".arjunDepositPrecommitment");
        assertEq(pool.getLastRoot(), uint256(pi[0]));
    }

    function test_bothSidesBet() public {
        _bothBet();
        uint256[] memory totals = markets.getSideTotals(1);
        assertEq(totals[0], 50e6);
        assertEq(totals[1], 80e6);
        assertEq(markets.getMarket(1).pot, 130e6);
    }

    function test_nullifierCannotBeReused() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        _spend("bet_priya");
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.NullifierSpent.selector);
        pool.spend(_spendArgs(pi), proof, "", "");
    }

    function test_unknownRootRejected() public {
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        pool.spend(_spendArgs(pi), proof, "", "");
    }

    function test_onlyNamedRelayerCanSubmit() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        vm.prank(makeAddr("frontrunner"));
        vm.expectRevert(ShieldedPool.WrongRelayer.selector);
        pool.spend(_spendArgs(pi), proof, "", "");
    }

    function test_tamperedFeeRejected() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        ShieldedPool.SpendArgs memory a = _spendArgs(pi);
        a.fee = 50e6;
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.spend(a, proof, "", "");
    }

    function test_tamperedSideRejected() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        ShieldedPool.SpendArgs memory a = _spendArgs(pi);
        a.actionParam2 = 1;
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.spend(a, proof, "", "");
    }

    function test_tamperedActionToWithdrawRejected() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        ShieldedPool.SpendArgs memory a = _spendArgs(pi);
        a.actionType = pool.ACTION_WITHDRAW();
        a.recipient = makeAddr("thief");
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.spend(a, proof, "", "");
    }

    function test_betAfterCloseRejected() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        vm.warp(closeTime);
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        vm.prank(relayer);
        vm.expectRevert(Markets.MarketClosed.selector);
        pool.spend(_spendArgs(pi), proof, "", "");
    }

    function test_onlyPoolCanAddBets() public {
        vm.expectRevert(Markets.NotPool.selector);
        markets.addBet(1, 0, 1_000e6);
    }

    function test_spendGas() public {
        _deposit(priya, ".priyaDepositPrecommitment");
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        ShieldedPool.SpendArgs memory a = _spendArgs(pi);
        vm.prank(relayer);
        uint256 g = gasleft();
        pool.spend(a, proof, "", "");
        emit log_named_uint("gas: private bet", g - gasleft());
    }

    function _rootAfter(string memory name) internal view returns (uint256) {
        (, bytes32[] memory pi) = _fixture(name);
        return uint256(pi[0]);
    }
}
