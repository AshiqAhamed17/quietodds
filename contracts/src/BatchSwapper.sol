// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ShieldedPool} from "./ShieldedPool.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @title BatchSwapper
/// @notice Private batch swaps, Aztec Connect-style. Users join the open batch
///         of a direction from their private balance (a `spend` proof with
///         action BATCH_JOIN, which mints a hidden ticket note). Once the
///         interval is over, anyone (or the CRE workflow) executes the batch as
///         ONE exact-in swap through the QuietOdds v4 pool, inside
///         `poolManager.unlock`. Ticket holders later redeem their share of the
///         output at the uniform ratio amountOut / totalIn.
///
///         On-chain, a join only shows "someone added X to batch N". Who
///         swapped, and who got what out, stays hidden.
/// @dev    The pool's ETH side may be native ETH (our Sepolia pool) or WETH;
///         private balances always hold WETH, so native ETH is wrapped and
///         unwrapped here. The tokens live in ShieldedPool until execution.
contract BatchSwapper is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Executed,
        Cancelled
    }

    struct Batch {
        uint8 direction;
        Status status;
        uint64 firstJoinAt; // the interval runs from the first join
        uint128 totalIn;
        uint128 amountOut;
    }

    uint8 public constant USDC_TO_WETH = 0;
    uint8 public constant WETH_TO_USDC = 1;

    uint256 public constant BATCH_INTERVAL = 5 minutes;
    /// After this long past the first join with no execution, the owner may cancel (refund).
    uint256 public constant BATCH_GRACE = 1 days;
    /// Dust joins would let anyone grief a batch with tiny tickets.
    uint256 public constant MIN_JOIN_USDC = 1e6; // 1 USDC
    uint256 public constant MIN_JOIN_WETH = 5e14; // 0.0005 WETH
    uint256 public constant MAX_FEED_STALENESS = 3 hours;
    uint256 public constant MAX_SLIPPAGE_BPS = 2_000;
    /// Matches the redeem circuit's u96 range on num/den.
    uint256 internal constant MAX_TOTAL = 2 ** 96 - 1;

    IPoolManager public immutable poolManager;
    AggregatorV3Interface public immutable ethUsdFeed;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;

    ShieldedPool public pool;
    PoolKey public poolKey;
    /// How far below the Chainlink price a batch may fill. Includes the 0.3% pool fee.
    uint256 public slippageBps = 100;

    uint256 public batchCount;
    mapping(uint8 direction => uint256 batchId) public currentBatch;
    mapping(uint256 batchId => Batch) internal _batches;

    event BatchOpened(uint256 indexed batchId, uint8 indexed direction);
    event BatchJoined(uint256 indexed batchId, uint256 amount, uint256 totalIn);
    event BatchExecuted(
        uint256 indexed batchId, uint8 indexed direction, uint256 totalIn, uint256 amountOut, uint256 minOut
    );
    event BatchCancelled(uint256 indexed batchId);
    event PoolSet(address pool);
    event PoolKeySet(PoolKey key);
    event SlippageSet(uint256 bps);

    error NotPool();
    error NotPoolManager();
    error AlreadySet();
    error BadPoolKey();
    error PoolKeyNotSet();
    error BatchNotOpen();
    error WrongAsset();
    error JoinTooSmall();
    error BatchTooLarge();
    error EmptyBatch();
    error IntervalNotOver();
    error GraceNotOver();
    error PartialFill();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error InvalidPrice();
    error StalePrice();
    error BadSlippage();
    error NotFinal();

    modifier onlyPool() {
        if (msg.sender != address(pool)) revert NotPool();
        _;
    }

    constructor(
        address owner_,
        IPoolManager poolManager_,
        AggregatorV3Interface ethUsdFeed_,
        IERC20 usdc_,
        IERC20 weth_
    ) Ownable(owner_) {
        poolManager = poolManager_;
        ethUsdFeed = ethUsdFeed_;
        usdc = usdc_;
        weth = weth_;
    }

    /// Native ETH arrives from the PoolManager (take) and from WETH (withdraw).
    receive() external payable {}

    // --- admin ---------------------------------------------------------------

    /// @notice One-time link to the ShieldedPool. Opens the first batch of each direction.
    function setPool(ShieldedPool pool_) external onlyOwner {
        if (address(pool) != address(0)) revert AlreadySet();
        pool = pool_;
        emit PoolSet(address(pool_));
        _open(USDC_TO_WETH);
        _open(WETH_TO_USDC);
    }

    /// @notice One-time: the v4 pool batches swap through (deployed after the
    ///         hook, which needs the ShieldedPool address first).
    function setPoolKey(PoolKey calldata key) external onlyOwner {
        if (poolKey.tickSpacing != 0) revert AlreadySet();
        Currency u = Currency.wrap(address(usdc));
        Currency eth = key.currency0 == u ? key.currency1 : key.currency0;
        if (!(key.currency0 == u || key.currency1 == u)) revert BadPoolKey();
        if (!(eth.isAddressZero() || Currency.unwrap(eth) == address(weth))) revert BadPoolKey();
        poolKey = key;
        emit PoolKeySet(key);
    }

    function setSlippage(uint256 bps) external onlyOwner {
        if (bps > MAX_SLIPPAGE_BPS) revert BadSlippage();
        slippageBps = bps;
        emit SlippageSet(bps);
    }

    // --- join (pool only) ----------------------------------------------------

    /// @notice Adds a private join to an open batch. The tokens already sit in
    ///         the ShieldedPool; it inserts the ticket leaf.
    function join(uint256 batchId, uint256 asset, uint256 amount) external onlyPool {
        Batch storage b = _batches[batchId];
        if (b.status != Status.Open) revert BatchNotOpen();
        if (asset != _assetIn(b.direction)) revert WrongAsset();
        if (amount < (b.direction == USDC_TO_WETH ? MIN_JOIN_USDC : MIN_JOIN_WETH)) revert JoinTooSmall();
        uint256 total = b.totalIn + amount;
        if (total > MAX_TOTAL) revert BatchTooLarge();
        b.totalIn = uint128(total);
        if (b.firstJoinAt == 0) b.firstJoinAt = uint64(block.timestamp);
        emit BatchJoined(batchId, amount, total);
    }

    // --- execute -------------------------------------------------------------

    /// @notice Swaps a batch's whole input in one exact-in swap. Permissionless
    ///         once the interval is over; the CRE workflow calls it on schedule.
    function executeBatch(uint256 batchId) external nonReentrant returns (uint256 amountOut) {
        Batch storage b = _batches[batchId];
        if (b.status != Status.Open) revert BatchNotOpen();
        if (b.totalIn == 0) revert EmptyBatch();
        if (block.timestamp < b.firstJoinAt + BATCH_INTERVAL) revert IntervalNotOver();
        if (poolKey.tickSpacing == 0) revert PoolKeyNotSet();

        uint8 direction = b.direction;
        uint256 totalIn = b.totalIn;
        uint256 minOut = minOutFor(direction, totalIn);

        // Pull the batch's input from the ShieldedPool, run the swap, send the output back.
        pool.releaseToBatches(_assetIn(direction), totalIn);
        amountOut = abi.decode(poolManager.unlock(abi.encode(direction, totalIn)), (uint256));
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        if (amountOut > MAX_TOTAL) revert BatchTooLarge();
        (direction == USDC_TO_WETH ? weth : usdc).safeTransfer(address(pool), amountOut);

        b.status = Status.Executed;
        b.amountOut = uint128(amountOut);
        emit BatchExecuted(batchId, direction, totalIn, amountOut, minOut);
        _open(direction);
    }

    /// @dev One exact-in swap with no hookData (a plain swap for the hook, so
    ///      the anti-sandwich guard still applies). Settles the input, takes the output.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 direction, uint256 amountIn) = abi.decode(data, (uint8, uint256));
        PoolKey memory key = poolKey;

        Currency cIn = direction == USDC_TO_WETH ? Currency.wrap(address(usdc)) : _ethCurrency(key);
        Currency cOut = direction == USDC_TO_WETH ? _ethCurrency(key) : Currency.wrap(address(usdc));
        bool zeroForOne = cIn == key.currency0;

        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (int128 dIn, int128 dOut) = zeroForOne ? (delta.amount0(), delta.amount1()) : (delta.amount1(), delta.amount0());
        // Every ticket paid in full, so the whole input must be swapped.
        if (uint256(int256(-dIn)) != amountIn) revert PartialFill();
        uint256 amountOut = uint256(int256(dOut));

        _settle(cIn, amountIn);
        poolManager.take(cOut, address(this), amountOut);
        if (cOut.isAddressZero()) IWETH(address(weth)).deposit{value: amountOut}();
        return abi.encode(amountOut);
    }

    // --- refund --------------------------------------------------------------

    /// @notice Safety valve: if a batch can't execute (e.g. the pool drifted
    ///         from the oracle), refund every ticket 1:1 in the input asset.
    ///         The input never left the ShieldedPool.
    function cancelStale(uint256 batchId) external onlyOwner {
        Batch storage b = _batches[batchId];
        if (b.status != Status.Open) revert BatchNotOpen();
        if (b.totalIn == 0) revert EmptyBatch();
        if (block.timestamp < b.firstJoinAt + BATCH_GRACE) revert GraceNotOver();
        b.status = Status.Cancelled;
        emit BatchCancelled(batchId);
        _open(b.direction);
    }

    // --- views ---------------------------------------------------------------

    /// @notice The ratio the redeem circuit must use for this batch's tickets.
    ///         executed: payout = amountIn * amountOut / totalIn, in the output asset.
    ///         cancelled: payout = amountIn, in the input asset.
    function redeemTerms(uint256 batchId) external view returns (uint256 num, uint256 den, uint256 assetOut) {
        Batch storage b = _batches[batchId];
        if (b.status == Status.Executed) return (b.amountOut, b.totalIn, _assetOut(b.direction));
        if (b.status == Status.Cancelled) return (1, 1, _assetIn(b.direction));
        revert NotFinal();
    }

    /// @notice The least a batch must get out: the Chainlink ETH/USD price less `slippageBps`.
    function minOutFor(uint8 direction, uint256 amountIn) public view returns (uint256) {
        (, int256 price,, uint256 updatedAt,) = ethUsdFeed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_FEED_STALENESS) revert StalePrice();
        // USDC has 6 decimals, WETH 18, the feed 8: wei = usdc * 10^(18 - 6 + 8) / price.
        uint256 expected =
            direction == USDC_TO_WETH ? (amountIn * 1e20) / uint256(price) : (amountIn * uint256(price)) / 1e20;
        return (expected * (10_000 - slippageBps)) / 10_000;
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    /// @notice True once `executeBatch` would pass its timing checks.
    function isExecutable(uint256 batchId) external view returns (bool) {
        Batch storage b = _batches[batchId];
        return b.status == Status.Open && b.totalIn > 0 && block.timestamp >= b.firstJoinAt + BATCH_INTERVAL;
    }

    // --- internals -----------------------------------------------------------

    function _open(uint8 direction) internal {
        uint256 id = ++batchCount;
        _batches[id] = Batch({direction: direction, status: Status.Open, firstJoinAt: 0, totalIn: 0, amountOut: 0});
        currentBatch[direction] = id;
        emit BatchOpened(id, direction);
    }

    function _assetIn(uint8 direction) internal pure returns (uint256) {
        return direction == USDC_TO_WETH ? 1 : 2; // ShieldedPool.ASSET_USDC / ASSET_WETH
    }

    function _assetOut(uint8 direction) internal pure returns (uint256) {
        return direction == USDC_TO_WETH ? 2 : 1;
    }

    function _ethCurrency(PoolKey memory key) internal view returns (Currency) {
        return Currency.unwrap(key.currency0) == address(usdc) ? key.currency1 : key.currency0;
    }

    function _settle(Currency c, uint256 amount) internal {
        if (c.isAddressZero()) {
            IWETH(address(weth)).withdraw(amount);
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }
}
