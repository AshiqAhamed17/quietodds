// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoseidonT5} from "poseidon-solidity/PoseidonT5.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint128} from "@uniswap/v4-core/src/libraries/FixedPoint128.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {BatchSwapper} from "../src/BatchSwapper.sol";
import {Markets} from "../src/Markets.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {QuietOddsHook} from "../src/QuietOddsHook.sol";
import {MockFeed} from "./mocks/MockFeed.sol";

/// Private batch swaps end to end: real BATCH_JOIN proofs (the batch story in
/// scripts/gen-fixtures.mjs), then one swap through a real v4 PoolManager and
/// the QuietOdds hook, on a native-ETH/USDC pool like the Sepolia one.
contract BatchSwapperTest is Deployers {
    using StateLibrary for IPoolManager;
    uint160 constant FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    int256 constant ETH_USD = 2000e8;
    uint256 constant USDC_TO_WETH_BATCH = 1;
    uint256 constant WETH_TO_USDC_BATCH = 2;

    ShieldedPool pool;
    BatchSwapper batches;
    Markets markets;
    MockERC20 usdc;
    WETH weth;
    MockFeed feed;
    PoolKey poolKey;
    address relayer = address(0xbeef);
    string story;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployFreshManagerAndRouters();
        usdc = new MockERC20("USDC", "USDC", 6);
        weth = new WETH();
        feed = new MockFeed();
        feed.set(ETH_USD, block.timestamp);

        markets = new Markets(address(this));
        batches = new BatchSwapper(
            address(this), manager, AggregatorV3Interface(address(feed)), IERC20(address(usdc)), IERC20(address(weth))
        );
        // The verifiers need solc >=0.8.27 and PoolManager pins 0.8.26, so they
        // come from their own build artifacts.
        pool = new ShieldedPool(
            IVerifier(deployCode("SpendVerifier.sol:SpendVerifier")),
            IVerifier(deployCode("RedeemVerifier.sol:RedeemVerifier")),
            markets,
            batches,
            IERC20(address(usdc)),
            IERC20(address(weth))
        );
        markets.setPool(address(pool));
        batches.setPool(pool);

        // Native ETH / USDC at $2,000, 100 ETH + 200k USDC full range.
        address hookAddr = address(FLAGS | (uint160(7) << 144));
        deployCodeTo("QuietOddsHook.sol:QuietOddsHook", abi.encode(manager, pool), hookAddr);
        uint160 sqrtPrice = uint160(Math.sqrt((uint256(ETH_USD) << 192) / 1e20));
        (poolKey,) = initPool(
            Currency.wrap(address(0)),
            Currency.wrap(address(usdc)),
            IHooks(hookAddr),
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            sqrtPrice
        );
        usdc.mint(address(this), 1e12);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        vm.deal(address(this), 1_000 ether);
        modifyLiquidityRouter.modifyLiquidity{value: 101 ether}(
            poolKey, ModifyLiquidityParams(-887220, 887220, 4.472e15, 0), ""
        );
        batches.setPoolKey(poolKey);

        story = vm.readFile("test/fixtures/batch_story.json");
    }

    // --- helpers -------------------------------------------------------------

    function _deposit(uint256 asset, uint256 amount, string memory who) internal {
        uint256 pc = vm.parseJsonUint(story, string.concat(".", who, "DepositPrecommitment"));
        if (asset == 1) {
            usdc.mint(address(this), amount);
            usdc.approve(address(pool), amount);
        } else {
            weth.deposit{value: amount}();
            weth.approve(address(pool), amount);
        }
        pool.deposit(asset, amount, pc, "");
    }

    function _join(string memory name) internal {
        (bytes memory proof, ShieldedPool.SpendArgs memory a) = _fixture(name);
        vm.prank(relayer);
        pool.spend(a, proof, "", hex"7c");
    }

    function _fixture(string memory name) internal view returns (bytes memory proof, ShieldedPool.SpendArgs memory a) {
        string memory json = vm.readFile(string.concat("test/fixtures/", name, ".json"));
        proof = vm.parseJsonBytes(json, ".proof");
        bytes32[] memory pi = vm.parseJsonBytes32Array(json, ".publicInputs");
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

    /// Priya (50) and Rahul (30) in the USDC->WETH batch, Arjun (0.02) in WETH->USDC.
    function _joinAll() internal {
        _deposit(1, 100e6, "priya");
        _join("join_priya");
        _deposit(1, 100e6, "rahul");
        _join("join_rahul");
        _deposit(2, 0.02 ether, "arjun");
        _join("join_arjun_weth");
    }

    function _ready() internal {
        vm.warp(block.timestamp + batches.BATCH_INTERVAL());
        vm.roll(block.number + 1);
        feed.set(ETH_USD, block.timestamp);
    }

    /// What the same exact-in swap would give a plain swapper, rolled back.
    function _controlSwap(bool zeroForOne, uint256 amountIn) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        uint256 e = address(this).balance;
        uint256 u = usdc.balanceOf(address(this));
        if (zeroForOne) {
            swapNativeInput(poolKey, true, -int256(amountIn), "", amountIn);
            out = usdc.balanceOf(address(this)) - u;
        } else {
            swap(poolKey, false, -int256(amountIn), "");
            out = address(this).balance - e;
        }
        vm.revertToState(snap);
    }

    // --- 5.1 BATCH_JOIN --------------------------------------------------------

    function test_setPoolOpensOneBatchPerDirection() public view {
        assertEq(batches.currentBatch(0), USDC_TO_WETH_BATCH);
        assertEq(batches.currentBatch(1), WETH_TO_USDC_BATCH);
        assertEq(uint8(batches.getBatch(1).status), uint8(BatchSwapper.Status.Open));
        assertEq(batches.getBatch(2).direction, 1);
    }

    function test_joinMintsTicketAndAddsToBatch() public {
        _deposit(1, 100e6, "priya");
        uint256 ticket = vm.parseJsonUint(story, ".leaves[2]");
        assertEq(ticket, PoseidonT5.hash([uint256(3), 1, 50e6, _fixtureOutPc("join_priya")]));

        vm.expectEmit(true, false, false, true, address(batches));
        emit BatchSwapper.BatchJoined(1, 50e6, 50e6);
        _join("join_priya");

        BatchSwapper.Batch memory b = batches.getBatch(1);
        assertEq(b.totalIn, 50e6);
        assertEq(b.firstJoinAt, block.timestamp);
        assertEq(pool.nextLeafIndex(), 3); // deposit, change, ticket
        assertEq(usdc.balanceOf(relayer), 0.5e6);
        // The pooled input stays in the ShieldedPool until execution.
        assertEq(usdc.balanceOf(address(pool)), 99.5e6);

        // Rahul's proof was made against the tree that includes Priya's ticket,
        // so it only verifies if the contract built the same ticket leaf.
        _deposit(1, 100e6, "rahul");
        _join("join_rahul");
        assertEq(batches.getBatch(1).totalIn, 80e6);
        assertEq(batches.getBatch(1).firstJoinAt, b.firstJoinAt, "interval runs from the first join");
    }

    function test_wethJoinGoesToTheWethBatch() public {
        _joinAll();
        assertEq(batches.getBatch(2).totalIn, 0.02 ether);
        assertEq(weth.balanceOf(address(pool)), 0.02 ether);
    }

    function _fixtureOutPc(string memory name) internal view returns (uint256) {
        (, ShieldedPool.SpendArgs memory a) = _fixture(name);
        return a.outPrecommitment;
    }

    function test_joinRejectsWrongAssetDustAndClosedBatch() public {
        vm.startPrank(address(pool));
        vm.expectRevert(BatchSwapper.WrongAsset.selector);
        batches.join(USDC_TO_WETH_BATCH, 2, 1 ether);
        vm.expectRevert(BatchSwapper.JoinTooSmall.selector);
        batches.join(USDC_TO_WETH_BATCH, 1, 0.99e6);
        vm.expectRevert(BatchSwapper.JoinTooSmall.selector);
        batches.join(WETH_TO_USDC_BATCH, 2, 4e14);
        vm.expectRevert(BatchSwapper.BatchNotOpen.selector);
        batches.join(99, 1, 10e6);
        vm.expectRevert(BatchSwapper.BatchTooLarge.selector);
        batches.join(USDC_TO_WETH_BATCH, 1, 2 ** 96);
        vm.stopPrank();
    }

    function test_onlyPoolJoinsOnlyBatchesReleases() public {
        vm.expectRevert(BatchSwapper.NotPool.selector);
        batches.join(USDC_TO_WETH_BATCH, 1, 10e6);
        vm.expectRevert(ShieldedPool.NotBatches.selector);
        pool.releaseToBatches(1, 1);
    }

    function test_joinAfterExecutionReverts() public {
        _deposit(1, 100e6, "priya");
        _join("join_priya");
        _ready();
        batches.executeBatch(USDC_TO_WETH_BATCH);

        // Rahul's proof names batch 1, which has already swapped.
        _deposit(1, 100e6, "rahul");
        (bytes memory proof, ShieldedPool.SpendArgs memory a) = _fixture("join_rahul");
        vm.prank(relayer);
        vm.expectRevert(BatchSwapper.BatchNotOpen.selector);
        pool.spend(a, proof, "", "");
    }

    // --- 5.2 executeBatch ----------------------------------------------------

    function test_executeUsdcToWethBatch() public {
        _joinAll();
        _ready();
        uint256 expected = _controlSwap(false, 80e6);
        uint256 minOut = batches.minOutFor(0, 80e6);
        uint256 usdcBefore = usdc.balanceOf(address(pool));
        uint256 leaves = pool.nextLeafIndex();

        vm.expectEmit(true, true, false, true, address(batches));
        emit BatchSwapper.BatchExecuted(1, 0, 80e6, expected, minOut);
        uint256 gasBefore = gasleft();
        uint256 out = batches.executeBatch(USDC_TO_WETH_BATCH);
        emit log_named_uint("executeBatch gas", gasBefore - gasleft());

        // One plain swap at the pool price: exactly what a lone swapper of 80 USDC gets.
        assertEq(out, expected, "same as a plain swap");
        assertGe(out, minOut);
        assertApproxEqRel(out, 0.04 ether, 0.01e18); // 80 USDC at $2,000, less the 0.3% fee
        assertEq(weth.balanceOf(address(pool)), 0.02 ether + out, "output wrapped and back in the pool");
        assertEq(usdc.balanceOf(address(pool)), usdcBefore - 80e6);
        assertEq(address(batches).balance, 0);
        assertEq(usdc.balanceOf(address(batches)), 0);
        assertEq(weth.balanceOf(address(batches)), 0);
        assertEq(pool.nextLeafIndex(), leaves, "no hidden shield in the batch swap");

        BatchSwapper.Batch memory b = batches.getBatch(1);
        assertEq(uint8(b.status), uint8(BatchSwapper.Status.Executed));
        assertEq(b.amountOut, out);
        (uint256 num, uint256 den, uint256 assetOut) = batches.redeemTerms(1);
        assertEq(num, out);
        assertEq(den, 80e6);
        assertEq(assetOut, 2);

        // A fresh batch opened for the next round.
        assertEq(batches.currentBatch(0), 3);
        assertEq(uint8(batches.getBatch(3).status), uint8(BatchSwapper.Status.Open));
    }

    function test_executeWethToUsdcBatch() public {
        _joinAll();
        _ready();
        uint256 expected = _controlSwap(true, 0.02 ether);
        uint256 usdcBefore = usdc.balanceOf(address(pool));

        uint256 out = batches.executeBatch(WETH_TO_USDC_BATCH);

        assertEq(out, expected, "same as a plain swap");
        assertApproxEqRel(out, 40e6, 0.01e18);
        assertEq(usdc.balanceOf(address(pool)), usdcBefore + out);
        assertEq(weth.balanceOf(address(pool)), 0);
        (uint256 num, uint256 den, uint256 assetOut) = batches.redeemTerms(2);
        assertEq(num, out);
        assertEq(den, 0.02 ether);
        assertEq(assetOut, 1);
        assertEq(batches.currentBatch(1), 3);
    }

    function test_executeChecksTiming() public {
        vm.expectRevert(BatchSwapper.EmptyBatch.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);

        _joinAll();
        assertFalse(batches.isExecutable(USDC_TO_WETH_BATCH));
        vm.warp(block.timestamp + batches.BATCH_INTERVAL() - 1);
        vm.expectRevert(BatchSwapper.IntervalNotOver.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);

        vm.warp(block.timestamp + 1);
        feed.set(ETH_USD, block.timestamp);
        assertTrue(batches.isExecutable(USDC_TO_WETH_BATCH));
        batches.executeBatch(USDC_TO_WETH_BATCH);
        vm.expectRevert(BatchSwapper.BatchNotOpen.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);
        assertFalse(batches.isExecutable(USDC_TO_WETH_BATCH));
    }

    function test_redeemTermsRevertUntilFinal() public {
        vm.expectRevert(BatchSwapper.NotFinal.selector);
        batches.redeemTerms(USDC_TO_WETH_BATCH);
    }

    /// A front-run that moves the price more than the slippage budget makes the
    /// batch revert instead of filling badly. The input never leaves the pool.
    function test_frontRunBeyondOracleBoundReverts() public {
        _joinAll();
        _ready();
        // The attacker buys ETH first, pushing its price up ~4%.
        swap(poolKey, false, -4_000e6, "");

        uint256 poolUsdc = usdc.balanceOf(address(pool));
        vm.expectPartialRevert(BatchSwapper.InsufficientOutput.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);
        assertEq(usdc.balanceOf(address(pool)), poolUsdc);
        assertEq(uint8(batches.getBatch(1).status), uint8(BatchSwapper.Status.Open));
    }

    /// Whatever a same-block front-run does, the batch either fills at or
    /// above the oracle bound or doesn't fill at all.
    function test_batchNeverFillsWorseThanOracleBound(uint256 front) public {
        _joinAll();
        _ready();
        front = bound(front, 0, 3_000e6);
        if (front > 0) swap(poolKey, false, -int256(front), "");
        try batches.executeBatch(USDC_TO_WETH_BATCH) returns (uint256 out) {
            assertGe(out, batches.minOutFor(0, 80e6));
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), BatchSwapper.InsufficientOutput.selector);
        }
    }

    function test_oracleChecks() public {
        _joinAll();
        vm.warp(block.timestamp + batches.MAX_FEED_STALENESS() + 1);
        vm.expectRevert(BatchSwapper.StalePrice.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);

        feed.set(0, block.timestamp);
        vm.expectRevert(BatchSwapper.InvalidPrice.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);

        // The oracle says ETH is far cheaper than the pool does: refuse to fill.
        feed.set(1_500e8, block.timestamp);
        vm.expectPartialRevert(BatchSwapper.InsufficientOutput.selector);
        batches.executeBatch(USDC_TO_WETH_BATCH);

        // The owner can widen the budget (thin testnet pools drift from the oracle).
        batches.setSlippage(2_000);
        feed.set(2_400e8, block.timestamp);
        batches.executeBatch(USDC_TO_WETH_BATCH);
    }

    function test_cancelStaleRefundsInInputAsset() public {
        _joinAll();
        vm.expectRevert(BatchSwapper.GraceNotOver.selector);
        batches.cancelStale(USDC_TO_WETH_BATCH);

        vm.warp(block.timestamp + batches.BATCH_GRACE());
        batches.cancelStale(USDC_TO_WETH_BATCH);
        (uint256 num, uint256 den, uint256 assetOut) = batches.redeemTerms(1);
        assertEq(num, 1);
        assertEq(den, 1);
        assertEq(assetOut, 1, "refund in USDC");
        assertEq(batches.currentBatch(0), 3);

        vm.prank(address(0xdead));
        vm.expectRevert();
        batches.cancelStale(WETH_TO_USDC_BATCH);
    }

    function test_adminSettersAreOneTimeAndBounded() public {
        vm.expectRevert(BatchSwapper.AlreadySet.selector);
        batches.setPool(pool);
        vm.expectRevert(BatchSwapper.AlreadySet.selector);
        batches.setPoolKey(poolKey);
        vm.expectRevert(BatchSwapper.BadSlippage.selector);
        batches.setSlippage(2_001);

        BatchSwapper fresh = new BatchSwapper(
            address(this), manager, AggregatorV3Interface(address(feed)), IERC20(address(usdc)), IERC20(address(weth))
        );
        PoolKey memory bad = poolKey;
        bad.currency1 = Currency.wrap(address(0x1234));
        vm.expectRevert(BatchSwapper.BadPoolKey.selector);
        fresh.setPoolKey(bad);
    }

    function test_unlockCallbackOnlyFromPoolManager() public {
        vm.expectRevert(BatchSwapper.NotPoolManager.selector);
        batches.unlockCallback(abi.encode(uint8(0), uint8(0), uint256(1e6)));
    }

    // --- 5.3 redeem tickets ----------------------------------------------------

    function _redeemFixture(string memory name)
        internal
        view
        returns (bytes memory proof, ShieldedPool.RedeemArgs memory a, uint256 payout)
    {
        string memory json = vm.readFile(string.concat("test/fixtures/", name, ".json"));
        proof = vm.parseJsonBytes(json, ".proof");
        bytes32[] memory pi = vm.parseJsonBytes32Array(json, ".publicInputs");
        a = ShieldedPool.RedeemArgs(
            uint256(pi[0]),
            uint256(pi[1]),
            uint256(pi[2]),
            uint256(pi[3]),
            uint256(pi[9]),
            address(uint160(uint256(pi[10]))),
            uint256(pi[11])
        );
        payout = vm.parseJsonUint(json, ".ctx.payout");
    }

    function _redeem(string memory name) internal returns (uint256 payout, uint256 fee) {
        (bytes memory proof, ShieldedPool.RedeemArgs memory a, uint256 p) = _redeemFixture(name);
        vm.prank(relayer);
        pool.redeem(a, proof, hex"7d");
        return (p, a.fee);
    }

    /// Both batches execute in one block, as in the fixture story. The second
    /// reverses the first one's move but still pays the base fee (the hook
    /// exempts the BatchSwapper from the directional fee).
    function _executeBoth() internal returns (uint256 out1, uint256 out2) {
        _joinAll();
        _ready();
        out1 = batches.executeBatch(USDC_TO_WETH_BATCH);
        out2 = batches.executeBatch(WETH_TO_USDC_BATCH);
        // The redeem fixtures were proven against these exact outputs.
        assertEq(out1, vm.parseJsonUint(story, ".batch1Out"), "regenerate: node scripts/gen-fixtures.mjs batch");
        assertEq(out2, vm.parseJsonUint(story, ".batch2Out"), "regenerate: node scripts/gen-fixtures.mjs batch");
    }

    function test_secondBatchInABlockPaysTheBaseFee() public {
        _joinAll();
        _ready();
        batches.executeBatch(USDC_TO_WETH_BATCH);
        // Anyone else reversing batch 1's move now would pay the directional fee...
        QuietOddsHook hook = QuietOddsHook(address(poolKey.hooks));
        assertGt(hook.directionalFee(poolKey, true), hook.BASE_FEE());
        // ...but batch 2 gets the plain-swap output the fixtures were proven for.
        assertEq(batches.executeBatch(WETH_TO_USDC_BATCH), vm.parseJsonUint(story, ".batch2Out"));
    }

    function test_ticketsRedeemTheirProRataShare() public {
        (uint256 out1, uint256 out2) = _executeBoth();

        vm.expectEmit(false, true, true, false, address(pool));
        emit ShieldedPool.Redeem(0, 3, USDC_TO_WETH_BATCH);
        (uint256 priya, uint256 priyaFee) = _redeem("redeem_ticket_priya");
        (uint256 rahul,) = _redeem("redeem_ticket_rahul");
        (uint256 arjun, uint256 arjunFee) = _redeem("redeem_ticket_arjun");

        // Pro rata at one uniform price: 50/80 and 30/80 of the batch output.
        assertEq(priya, (50e6 * out1) / 80e6);
        assertEq(rahul, (30e6 * out1) / 80e6);
        assertEq(arjun, out2);
        // Rounding only ever leaves dust in the pool, never takes more out.
        assertLe(priya + rahul, out1);
        assertLe(out1 - priya - rahul, 1);
        assertEq(pool.nextLeafIndex(), 12, "one hidden balance note per ticket");

        // Relayer fees come out of the payout, in the output asset.
        assertEq(weth.balanceOf(relayer), priyaFee);
        assertEq(usdc.balanceOf(relayer), 1e6 + arjunFee); // + two 0.5 USDC join fees
        // The pool still holds every unspent note: the three outputs, plus change.
        assertGe(weth.balanceOf(address(pool)), (priya - priyaFee) + rahul);
        assertEq(usdc.balanceOf(address(pool)), 49.5e6 + 69.5e6 + arjun - arjunFee);
    }

    function test_ticketRedeemsOnlyOnce() public {
        _executeBoth();
        _redeem("redeem_ticket_priya");
        (bytes memory proof, ShieldedPool.RedeemArgs memory a,) = _redeemFixture("redeem_ticket_priya");
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.NullifierSpent.selector);
        pool.redeem(a, proof, "");
    }

    function test_ticketCannotRedeemBeforeExecution() public {
        _joinAll();
        (bytes memory proof, ShieldedPool.RedeemArgs memory a,) = _redeemFixture("redeem_ticket_priya");
        vm.prank(relayer);
        vm.expectRevert(BatchSwapper.NotFinal.selector);
        pool.redeem(a, proof, "");
    }

    /// The contract supplies the ratio: a proof made for other terms (here the
    /// 1:1 refund) is rejected once the batch has really executed.
    function test_ticketMustUseTheBatchRatio() public {
        _executeBoth();
        (bytes memory proof, ShieldedPool.RedeemArgs memory a,) = _redeemFixture("redeem_ticket_priya_refund");
        vm.prank(relayer);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.redeem(a, proof, "");
    }

    function test_cancelledBatchRefundsTicket1to1() public {
        _joinAll();
        vm.warp(block.timestamp + batches.BATCH_GRACE());
        batches.cancelStale(USDC_TO_WETH_BATCH);
        uint256 relayerBefore = usdc.balanceOf(relayer);
        (uint256 payout, uint256 fee) = _redeem("redeem_ticket_priya_refund");
        assertEq(payout, 50e6);
        assertEq(usdc.balanceOf(relayer) - relayerBefore, fee);
        // Nothing left the pool: change notes + the refunded note are all covered.
        assertEq(usdc.balanceOf(address(pool)), 49.5e6 + 69.5e6 + 30e6 + (50e6 - fee));
    }

    // --- 5.4 donate market fees to LPs ----------------------------------------

    /// A resolved market with a 100 USDC pot: 1 USDC protocol fee accrues.
    function _accrueFees() internal {
        markets.createMarket(
            "m", "Yes|No", 2, uint64(block.timestamp + 1 hours), Markets.Source.Sports, "", address(0), 0
        );
        usdc.mint(address(pool), 100e6); // the stakes, as if bet privately
        vm.startPrank(address(pool));
        markets.addBet(1, 0, 60e6);
        markets.addBet(1, 1, 40e6);
        vm.stopPrank();
        markets.setResolver(address(this));
        vm.warp(block.timestamp + 1 hours);
        markets.resolve(1, 0);
        assertEq(markets.feesAccrued(), 1e6);
    }

    function test_donateFeesPaysInRangeLps() public {
        _accrueFees();
        (, uint256 growthBefore) = manager.getFeeGrowthGlobals(poolKey.toId());
        uint128 liquidity = manager.getLiquidity(poolKey.toId());
        uint256 poolUsdc = usdc.balanceOf(address(pool));
        uint256 managerUsdc = usdc.balanceOf(address(manager));

        vm.expectEmit(true, true, true, true, address(batches));
        emit BatchSwapper.FeesDonated(1e6);
        assertEq(batches.donateFees(), 1e6);

        (, uint256 growthAfter) = manager.getFeeGrowthGlobals(poolKey.toId());
        assertEq(growthAfter - growthBefore, FullMath.mulDiv(1e6, FixedPoint128.Q128, liquidity));
        assertEq(usdc.balanceOf(address(manager)), managerUsdc + 1e6);
        assertEq(usdc.balanceOf(address(pool)), poolUsdc - 1e6);
        assertEq(markets.feesAccrued(), 0);
        assertEq(usdc.balanceOf(address(batches)), 0);

        // The LP (this contract) collects it: a zero-liquidity poke pays out fees.
        uint256 lpBefore = usdc.balanceOf(address(this));
        modifyLiquidityRouter.modifyLiquidity(poolKey, ModifyLiquidityParams(-887220, 887220, 0, 0), "");
        assertApproxEqAbs(usdc.balanceOf(address(this)) - lpBefore, 1e6, 1);

        vm.expectRevert(BatchSwapper.NoFees.selector);
        batches.donateFees();
    }

    function test_donateFeesLeavesWinnersWhole() public {
        _accrueFees();
        batches.donateFees();
        // Winners are owed pot - fee = 99 USDC; the pool still holds it.
        (uint256 num,,,) = markets.redeemTerms(1);
        assertEq(num, 99e6);
        assertEq(usdc.balanceOf(address(pool)), 99e6);
    }

    function test_onlyBatchesReleasesFees() public {
        vm.expectRevert(ShieldedPool.NotBatches.selector);
        pool.releaseFees();
    }
}
