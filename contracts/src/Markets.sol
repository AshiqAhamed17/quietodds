// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title Markets
/// @notice Curated pari-mutuel markets. Per-side totals are public (live odds),
///         but nobody can tell who bet: bets arrive only from the ShieldedPool,
///         backed by zero-knowledge spends.
/// @dev    Resolution comes from the CRE ResolverReceiver, or permissionlessly
///         from a Chainlink price feed for PRICE markets. A market whose
///         winning side has no stake becomes a refund.
contract Markets is Ownable {
    enum Status {
        None,
        Open,
        Resolved,
        Cancelled
    }

    enum Source {
        Price, // "is the feed above `threshold`?" side 0 = NO, side 1 = YES
        Sports // result fetched from a sports API by the CRE workflow
    }

    struct Market {
        string question;
        uint8 numSides;
        uint64 closeTime;
        Source source;
        string sourceRef; // e.g. "espn:soccer/eng.1:740912" for sports markets
        address priceFeed; // Price markets only
        int256 threshold; // Price markets only, in feed decimals
        Status status;
        uint8 winningSide;
        uint256 pot;
        uint256 protocolFee;
    }

    uint8 public constant MAX_SIDES = 4;
    uint256 public constant FEE_BPS = 100; // 1%, donated to Uniswap LPs
    uint256 public constant MAX_FEED_STALENESS = 2 hours;
    /// After this long past close with no result, the owner may cancel (refund).
    uint256 public constant RESOLUTION_GRACE = 1 days;

    address public pool;
    address public resolver;
    uint256 public marketCount;
    uint256 public feesAccrued;

    mapping(uint256 marketId => Market) internal _markets;
    mapping(uint256 marketId => uint256[MAX_SIDES]) internal _sideTotals;

    event MarketCreated(uint256 indexed marketId, string question, uint8 numSides, uint64 closeTime, Source source);
    event BetPlaced(uint256 indexed marketId, uint8 indexed side, uint256 amount, uint256 sideTotal);
    event MarketResolved(uint256 indexed marketId, uint8 winningSide, uint256 pot, uint256 protocolFee);
    event MarketCancelled(uint256 indexed marketId);
    event PoolSet(address pool);
    event ResolverSet(address resolver);

    error NotPool();
    error NotResolver();
    error PoolAlreadySet();
    error BadSides();
    error BadCloseTime();
    error UnknownMarket();
    error MarketNotOpen();
    error MarketClosed();
    error MarketStillOpen();
    error SideOutOfRange();
    error NotPriceMarket();
    error InvalidPrice();
    error StalePrice();
    error NotFinal();
    error GraceNotOver();

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    constructor(address owner_) Ownable(owner_) {}

    // --- admin ---------------------------------------------------------------

    /// @notice One-time link to the ShieldedPool (deployed after this contract).
    function setPool(address pool_) external onlyOwner {
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        emit PoolSet(pool_);
    }

    function setResolver(address resolver_) external onlyOwner {
        resolver = resolver_;
        emit ResolverSet(resolver_);
    }

    function createMarket(
        string calldata question,
        uint8 numSides,
        uint64 closeTime,
        Source source,
        string calldata sourceRef,
        address priceFeed,
        int256 threshold
    ) external onlyOwner returns (uint256 marketId) {
        if (numSides < 2 || numSides > MAX_SIDES) revert BadSides();
        if (closeTime <= block.timestamp) revert BadCloseTime();
        if (source == Source.Price && (numSides != 2 || priceFeed == address(0))) revert NotPriceMarket();

        marketId = ++marketCount; // ids start at 1
        Market storage m = _markets[marketId];
        m.question = question;
        m.numSides = numSides;
        m.closeTime = closeTime;
        m.source = source;
        m.sourceRef = sourceRef;
        m.priceFeed = priceFeed;
        m.threshold = threshold;
        m.status = Status.Open;
        emit MarketCreated(marketId, question, numSides, closeTime, source);
    }

    // --- betting (pool only) -------------------------------------------------

    /// @notice Records an anonymous bet. The stake already sits in the pool.
    function addBet(uint256 marketId, uint8 side, uint256 amount) external onlyPool {
        Market storage m = _markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp >= m.closeTime) revert MarketClosed();
        if (side >= m.numSides) revert SideOutOfRange();
        uint256 total = _sideTotals[marketId][side] + amount;
        _sideTotals[marketId][side] = total;
        m.pot += amount;
        emit BetPlaced(marketId, side, amount, total);
    }

    // --- resolution ----------------------------------------------------------

    /// @notice Called by the CRE ResolverReceiver with the workflow's result.
    function resolve(uint256 marketId, uint8 winningSide) external onlyResolver {
        _resolve(marketId, winningSide);
    }

    function cancel(uint256 marketId) external onlyResolver {
        _cancel(marketId);
    }

    /// @notice Safety valve: refund everyone if no result arrived in time.
    function cancelStale(uint256 marketId) external onlyOwner {
        if (block.timestamp < _markets[marketId].closeTime + RESOLUTION_GRACE) revert GraceNotOver();
        _cancel(marketId);
    }

    /// @notice Permissionless resolution of a PRICE market from its Chainlink
    ///         feed. The price must be fresh and published after close.
    function resolveFromFeed(uint256 marketId) external {
        Market storage m = _markets[marketId];
        if (m.source != Source.Price || m.priceFeed == address(0)) revert NotPriceMarket();
        (, int256 price,, uint256 updatedAt,) = AggregatorV3Interface(m.priceFeed).latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (updatedAt < m.closeTime || block.timestamp - updatedAt > MAX_FEED_STALENESS) revert StalePrice();
        _resolve(marketId, price > m.threshold ? 1 : 0);
    }

    function _resolve(uint256 marketId, uint8 winningSide) internal {
        Market storage m = _markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp < m.closeTime) revert MarketStillOpen();
        if (winningSide >= m.numSides) revert SideOutOfRange();

        // Nobody backed the winner: refund everyone instead of locking the pot.
        if (_sideTotals[marketId][winningSide] == 0) {
            m.status = Status.Cancelled;
            emit MarketCancelled(marketId);
            return;
        }

        uint256 fee = (m.pot * FEE_BPS) / 10_000;
        m.status = Status.Resolved;
        m.winningSide = winningSide;
        m.protocolFee = fee;
        feesAccrued += fee;
        emit MarketResolved(marketId, winningSide, m.pot, fee);
    }

    function _cancel(uint256 marketId) internal {
        Market storage m = _markets[marketId];
        if (m.status != Status.Open) revert MarketNotOpen();
        m.status = Status.Cancelled;
        emit MarketCancelled(marketId);
    }

    // --- pool hooks ----------------------------------------------------------

    /// @notice The ratio the redeem circuit must use for this market's positions.
    ///         win: payout = stake * (pot - fee) / winningSideTotal, winners only.
    ///         refund: payout = stake, any side.
    function redeemTerms(uint256 marketId)
        external
        view
        returns (uint256 num, uint256 den, uint8 requiredSide, bool anySide)
    {
        Market storage m = _markets[marketId];
        if (m.status == Status.Resolved) {
            return (m.pot - m.protocolFee, _sideTotals[marketId][m.winningSide], m.winningSide, false);
        }
        if (m.status == Status.Cancelled) return (1, 1, 0, true);
        revert NotFinal();
    }

    /// @notice Hands accrued protocol fees to the pool for donation to LPs.
    function takeFees() external onlyPool returns (uint256 amount) {
        amount = feesAccrued;
        feesAccrued = 0;
    }

    // --- views ---------------------------------------------------------------

    function getMarket(uint256 marketId) external view returns (Market memory) {
        if (_markets[marketId].status == Status.None) revert UnknownMarket();
        return _markets[marketId];
    }

    function getSideTotals(uint256 marketId) external view returns (uint256[] memory totals) {
        uint8 n = _markets[marketId].numSides;
        totals = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            totals[i] = _sideTotals[marketId][i];
        }
    }

    function isOpen(uint256 marketId) external view returns (bool) {
        Market storage m = _markets[marketId];
        return m.status == Status.Open && block.timestamp < m.closeTime;
    }
}
