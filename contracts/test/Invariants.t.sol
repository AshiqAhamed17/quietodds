// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {BatchSwapper} from "../src/BatchSwapper.sol";
import {Markets} from "../src/Markets.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {SpendVerifier} from "../src/verifiers/SpendVerifier.sol";
import {RedeemVerifier} from "../src/verifiers/RedeemVerifier.sol";
import {TestToken} from "./ShieldedPool.t.sol";

abstract contract PoolFixture is Test {
    ShieldedPool pool;
    Markets markets;
    TestToken usdc;
    TestToken weth;
    address relayer = address(0xbeef);
    address resolver = makeAddr("resolver");
    uint64 closeTime;

    function _deploy() internal {
        vm.warp(1_800_000_000);
        usdc = new TestToken("USDC", 6);
        weth = new TestToken("WETH", 18);
        markets = new Markets(address(this));
        pool = new ShieldedPool(
            IVerifier(address(new SpendVerifier())),
            IVerifier(address(new RedeemVerifier())),
            markets,
            BatchSwapper(payable(address(0))),
            IERC20(address(usdc)),
            IERC20(address(weth))
        );
        markets.setPool(address(pool));
        markets.setResolver(resolver);
        closeTime = uint64(block.timestamp + 1 hours);
        markets.createMarket("m", "Yes|No", 2, closeTime, Markets.Source.Sports, "", address(0), 0);
    }

    function _fixture(string memory name) internal view returns (bytes memory proof, bytes32[] memory pi) {
        string memory json = vm.readFile(string.concat("test/fixtures/", name, ".json"));
        proof = vm.parseJsonBytes(json, ".proof");
        pi = vm.parseJsonBytes32Array(json, ".publicInputs");
    }
}

/// Fuzzes every public input of real proofs: any single change must be rejected.
contract TamperFuzzTest is PoolFixture {
    function setUp() public {
        _deploy();
        string memory story = vm.readFile("test/fixtures/story.json");
        usdc.mint(address(this), 200e6);
        usdc.approve(address(pool), 200e6);
        pool.deposit(1, 100e6, vm.parseJsonUint(story, ".priyaDepositPrecommitment"), "");
    }

    function _spendArgs(bytes32[] memory pi) internal pure returns (ShieldedPool.SpendArgs memory a) {
        a = ShieldedPool.SpendArgs(
            uint256(pi[0]),
            uint256(pi[1]),
            uint256(pi[2]),
            uint256(pi[3]),
            uint256(pi[4]),
            uint256(pi[5]),
            uint256(pi[6]),
            uint256(pi[7]),
            uint256(pi[8]),
            address(uint160(uint256(pi[9]))),
            uint256(pi[10]),
            address(uint160(uint256(pi[11])))
        );
    }

    function testFuzz_anyTamperedSpendInputRejected(uint8 index, uint256 mask) public {
        vm.assume(mask != 0);
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        uint256 i = index % 12;
        // Addresses must stay addresses, so tamper those within 160 bits.
        if (i == 9 || i == 11) mask = uint256(uint160(mask));
        vm.assume(mask != 0);
        pi[i] = bytes32(uint256(pi[i]) ^ mask);

        vm.prank(relayer);
        vm.expectRevert();
        pool.spend(_spendArgs(pi), proof, "", "");
    }

    function testFuzz_flippedProofByteRejected(uint256 position, uint8 mask) public {
        vm.assume(mask != 0);
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        position = bound(position, 0, proof.length - 1);
        proof[position] = bytes1(uint8(proof[position]) ^ mask);

        vm.prank(relayer);
        vm.expectRevert();
        pool.spend(_spendArgs(pi), proof, "", "");
    }

    function test_untamperedFixtureStillPasses() public {
        (bytes memory proof, bytes32[] memory pi) = _fixture("bet_priya");
        vm.prank(relayer);
        pool.spend(_spendArgs(pi), proof, "", "");
    }
}

/// Pari-mutuel math: winners can never be owed more than the pot minus the fee.
contract PayoutFuzzTest is PoolFixture {
    function setUp() public {
        _deploy();
    }

    function testFuzz_payoutsNeverExceedPot(uint64[8] memory stakes, bool[8] memory sides, bool winner) public {
        uint8 w = winner ? 1 : 0;
        uint256 winningStakes;
        vm.startPrank(address(pool));
        for (uint256 i = 0; i < 8; i++) {
            uint256 s = bound(stakes[i], 1, 1e15);
            stakes[i] = uint64(s);
            uint8 side = sides[i] ? 1 : 0;
            markets.addBet(1, side, s);
            if (side == w) winningStakes += s;
        }
        vm.stopPrank();

        vm.warp(closeTime);
        vm.prank(resolver);
        markets.resolve(1, w);

        Markets.Market memory m = markets.getMarket(1);
        (uint256 num, uint256 den, uint8 requiredSide, bool anySide) = markets.redeemTerms(1);
        if (winningStakes == 0) {
            // Nobody backed the winner: full refund, no fee.
            assertTrue(anySide);
            assertEq(num, den);
            return;
        }
        assertEq(requiredSide, w);
        assertEq(den, winningStakes);
        assertEq(num + m.protocolFee, m.pot);

        uint256 owed;
        for (uint256 i = 0; i < 8; i++) {
            if ((sides[i] ? 1 : 0) == w) owed += (uint256(stakes[i]) * num) / den;
        }
        assertLe(owed, num);
    }
}

/// Random deposits and junk spend/redeem attempts. Without a valid proof,
/// nothing can leave the pool and no nullifier can be burned.
contract PoolHandler is Test {
    ShieldedPool pool;
    TestToken usdc;
    uint256 public deposited;
    uint256 public deposits;
    uint256 public junkAccepted;

    constructor(ShieldedPool pool_, TestToken usdc_) {
        pool = pool_;
        usdc = usdc_;
    }

    function deposit(uint96 amount, uint256 precommitment) external {
        amount = uint96(bound(amount, 1, 1e12));
        precommitment = bound(precommitment, 0, 2 ** 250);
        usdc.mint(address(this), amount);
        usdc.approve(address(pool), amount);
        pool.deposit(1, amount, precommitment, "");
        deposited += amount;
        deposits++;
    }

    function junkSpend(uint256 nullifierHash, uint256 amount, address recipient, bytes calldata proof) external {
        ShieldedPool.SpendArgs memory a;
        a.root = pool.getLastRoot();
        a.nullifierHash = bound(nullifierHash, 0, 2 ** 250);
        a.asset = 1;
        a.changeCommitment = 1;
        a.publicAmount = bound(amount, 0, 1e12);
        a.actionType = 1;
        a.recipient = recipient == address(0) ? address(1) : recipient;
        try pool.spend(a, proof, "", "") {
            junkAccepted++;
        } catch {}
    }

    function junkRedeem(uint256 nullifierHash, bytes calldata proof) external {
        ShieldedPool.RedeemArgs memory a;
        a.root = pool.getLastRoot();
        a.nullifierHash = bound(nullifierHash, 0, 2 ** 250);
        a.kind = 2;
        a.id = 1;
        a.outCommitment = 1;
        try pool.redeem(a, proof, "") {
            junkAccepted++;
        } catch {}
    }
}

contract PoolInvariantTest is StdInvariant, PoolFixture {
    PoolHandler handler;

    function setUp() public {
        _deploy();
        handler = new PoolHandler(pool, usdc);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 40
    function invariant_poolHoldsEveryDeposit() public view {
        assertEq(usdc.balanceOf(address(pool)), handler.deposited());
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 40
    function invariant_noJunkProofAccepted() public view {
        assertEq(handler.junkAccepted(), 0);
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 40
    function invariant_oneLeafPerDeposit() public view {
        assertEq(pool.nextLeafIndex(), handler.deposits());
    }
}
