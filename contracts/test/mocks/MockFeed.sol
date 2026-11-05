// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Minimal Chainlink AggregatorV3 stand-in for unit tests only.
contract MockFeed {
    int256 public price;
    uint256 public updatedAt;

    function set(int256 price_, uint256 updatedAt_) external {
        price = price_;
        updatedAt = updatedAt_;
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, updatedAt, updatedAt, 1);
    }
}
