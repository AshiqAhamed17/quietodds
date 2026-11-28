// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {BatchSwapper} from "../src/BatchSwapper.sol";
import {Markets} from "../src/Markets.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IPoolVaultV2} from "../src/interfaces/IPoolVaultV2.sol";
import {PrivacyPoolsDepositor} from "../src/PrivacyPoolsDepositor.sol";
import {MockPoolVault} from "./mocks/MockPoolVault.sol";
import {TestToken} from "./ShieldedPool.t.sol";

contract PrivacyPoolsDepositorTest is Test {
    ShieldedPool pool;
    MockPoolVault vault;
    PrivacyPoolsDepositor depositor;
    TestToken usdc;
    TestToken weth;

    address relayer = makeAddr("relayer");
    uint256 constant PRECOMMITMENT = 123456789;
    bytes constant CIPHERTEXT = hex"c0ffee";

    function setUp() public {
        usdc = new TestToken("USDC", 6);
        weth = new TestToken("WETH", 18);
        // Deposits never touch the verifiers, markets or batches.
        pool = new ShieldedPool(
            IVerifier(address(0)),
            IVerifier(address(0)),
            Markets(address(0)),
            BatchSwapper(payable(address(0))),
            IERC20(address(usdc)),
            IERC20(address(weth))
        );
        vault = new MockPoolVault();
        depositor = new PrivacyPoolsDepositor(vault, pool);
        usdc.mint(address(vault), 1_000e6);
        weth.mint(address(vault), 1_000e18);
        vault.setPayout(IERC20(address(usdc)), 10e6);
    }

    function _data(address relayer_, uint256 fee) internal pure returns (bytes memory) {
        return abi.encode(PRECOMMITMENT, CIPHERTEXT, relayer_, fee);
    }

    /// A "proof" bound to this depositor as processor and to `data`.
    function _proof(bytes memory data, IPoolVaultV2.NoteData[] memory noteData)
        internal
        view
        returns (IPoolVaultV2.TransactProof memory proof)
    {
        proof.pubSignals = new uint256[][](1);
        proof.pubSignals[0] = new uint256[](1);
        proof.pubSignals[0][0] = vault.contextOf(IPoolVaultV2.TransactParams(address(depositor), data), noteData);
    }

    function _noteData() internal pure returns (IPoolVaultV2.NoteData[] memory n) {
        n = new IPoolVaultV2.NoteData[](1);
        n[0] = IPoolVaultV2.NoteData(bytes32(uint256(7)), hex"abcd");
    }

    function test_FundsPrivateBalanceAndPaysRelayer() public {
        bytes memory data = _data(relayer, 0.05e6);
        IPoolVaultV2.NoteData[] memory n = _noteData();

        IPoolVaultV2.TransactProof memory proof = _proof(data, n);

        vm.expectEmit(address(depositor));
        emit PrivacyPoolsDepositor.FundedFromPrivacyPools(0, 10e6, 0.05e6, relayer);
        vm.prank(relayer);
        uint256 leafIndex = depositor.fund(proof, data, n);

        assertEq(leafIndex, 0);
        assertEq(usdc.balanceOf(address(pool)), 9.95e6);
        assertEq(usdc.balanceOf(relayer), 0.05e6);
        assertEq(usdc.balanceOf(address(depositor)), 0, "keeps nothing");
    }

    function test_SelfSubmitWithoutFee() public {
        bytes memory data = _data(address(0), 0);
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(data, n);
        vm.prank(makeAddr("fresh"));
        depositor.fund(proof, data, n);
        assertEq(usdc.balanceOf(address(pool)), 10e6);
    }

    function test_RevertsForAnotherRelayer() public {
        bytes memory data = _data(relayer, 0.05e6);
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(data, n);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(PrivacyPoolsDepositor.WrongRelayer.selector);
        depositor.fund(proof, data, n);
    }

    function test_RevertsSelfSubmitWithFee() public {
        bytes memory data = _data(address(0), 1);
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(data, n);
        vm.expectRevert(PrivacyPoolsDepositor.WrongRelayer.selector);
        depositor.fund(proof, data, n);
    }

    function test_RevertsWhenFeeEatsEverything() public {
        bytes memory data = _data(relayer, 10e6);
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(data, n);
        vm.prank(relayer);
        vm.expectRevert(PrivacyPoolsDepositor.FeeTooHigh.selector);
        depositor.fund(proof, data, n);
    }

    function test_RevertsForANoteInAnotherToken() public {
        vault.setPayout(IERC20(address(weth)), 1e18);
        bytes memory data = _data(relayer, 0.05e6);
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(data, n);
        vm.prank(relayer);
        vm.expectRevert(PrivacyPoolsDepositor.FeeTooHigh.selector);
        depositor.fund(proof, data, n);
    }

    /// The relayer can't swap in its own precommitment (or fee): the proof no longer matches.
    function test_RevertsWhenDataIsChanged() public {
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(_data(relayer, 0.05e6), n);
        bytes memory tampered = abi.encode(uint256(666), CIPHERTEXT, relayer, uint256(0.05e6));
        vm.prank(relayer);
        vm.expectRevert(MockPoolVault.BadContext.selector);
        depositor.fund(proof, tampered, n);
    }

    function test_RevertsOnReentry() public {
        bytes memory data = _data(relayer, 0);
        IPoolVaultV2.NoteData[] memory n = _noteData();
        IPoolVaultV2.TransactProof memory proof = _proof(data, n);
        vault.setHook(address(depositor), abi.encodeCall(PrivacyPoolsDepositor.fund, (proof, data, n)));
        vm.prank(relayer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        depositor.fund(proof, data, n);
    }
}
