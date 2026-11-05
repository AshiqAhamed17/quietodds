# QuietOdds resolver (Chainlink CRE)

One TypeScript workflow, `resolver/`, on a cron trigger. Each run it:

1. reads `Markets.marketCount()` and `getMarket(id)` on Sepolia (EVM read capability);
2. picks open markets whose close time has passed (`runtime.now()`), up to `maxMarketsPerRun`;
3. gets each result:
   - **Price** markets: the market's Chainlink feed, YES iff price > threshold and the price was published after close (same rule as `Markets.resolveFromFeed`);
   - **Sports** markets: ESPN's single-event scoreboard (`espn:<sport>/<league>:<eventId>`), fetched by every node and agreed by median consensus. Side order is home | draw | away; postponed/cancelled matches refund;
4. sends one DON-signed report, `abi.encode(Action[])`, to `ResolverReceiver`, which resolves or cancels each market (a failing action is logged and skipped).

Bettors' identities never reach the workflow: it only sees public per-side totals.

```sh
cd resolver && bun install && bun test          # pure logic + report encoding
cd .. && cre workflow simulate resolver --target staging-settings \
  --non-interactive --trigger-index 0 -e ../.env                  # dry run
cre workflow simulate resolver --target staging-settings \
  --non-interactive --trigger-index 0 -e ../.env --broadcast      # real resolve tx
```

`--broadcast` writes through the CRE simulation forwarder
(`0x15fC…9F88`), which `ResolverReceiver` accepts until we switch it to the
production forwarder with `setForwarder` after `cre workflow deploy`.
`-e ../.env` supplies `CRE_ETH_PRIVATE_KEY` from the repo's root `.env`.

`staging` reads the latest block (fast demos); `production` reads finalized blocks.
