// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Markets} from "../src/Markets.sol";

/// Creates the curated launch markets.
///   forge script script/CreateMarkets.s.sol --rpc-url sepolia --broadcast
/// Sports sourceRef = "espn:<sport>/<league>:<eventId>", sides = home|draw|away,
/// resolved by the CRE workflow from ESPN's public scoreboard.
/// Price markets: side 0 = NO, side 1 = YES (feed price > threshold at close).
contract CreateMarkets is Script {
    address constant ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant BTC_USD = 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Markets markets = Markets(vm.parseJsonAddress(vm.readFile("../deployments/quietodds-sepolia.json"), ".Markets"));

        vm.startBroadcast(pk);
        _price(markets, "Will ETH be above $2,300 at 18:00 UTC on Nov 6?", 1793988000, ETH_USD, 2300e8);
        _sports(
            markets,
            "Nottingham Forest vs Manchester City (Premier League, Nov 7)",
            "Nottingham Forest|Draw|Manchester City",
            1794072600,
            "espn:soccer/eng.1:401878757"
        );
        _sports(
            markets,
            "Valencia vs Real Madrid (La Liga, Nov 7)",
            "Valencia|Draw|Real Madrid",
            1794081600,
            "espn:soccer/esp.1:401882808"
        );
        _sports(
            markets,
            "Paris Saint-Germain vs Troyes (Ligue 1, Nov 7)",
            "Paris Saint-Germain|Draw|Troyes",
            1794081900,
            "espn:soccer/fra.1:401876407"
        );
        _price(markets, "Will BTC be above $76,000 at 18:00 UTC on Nov 7?", 1794074400, BTC_USD, 76_000e8);
        _price(markets, "Will ETH be above $2,500 at 12:00 UTC on Nov 20?", 1795176000, ETH_USD, 2500e8);
        vm.stopBroadcast();

        console.log("markets created, total:", markets.marketCount());
    }

    function _price(Markets m, string memory q, uint64 closeTime, address feed, int256 threshold) internal {
        m.createMarket(q, "No|Yes", 2, closeTime, Markets.Source.Price, "", feed, threshold);
    }

    function _sports(Markets m, string memory q, string memory outcomes, uint64 closeTime, string memory ref) internal {
        m.createMarket(q, outcomes, 3, closeTime, Markets.Source.Sports, ref, address(0), 0);
    }
}
