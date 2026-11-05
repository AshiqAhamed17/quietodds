# QuietOdds

**A private prediction market and privacy layer for Uniswap v4.**

Bet without being seen. Odds are public, bettors are not.

- **Private bets**: deposit once into a shielded pool, then bet, claim and withdraw with zero-knowledge proofs. Nobody can link a bet, a side or a payout to you.
- **Bet from inside a swap**: a Uniswap v4 hook moves part of any USDC/WETH swap straight into your private balance.
- **Private batch swaps**: swap from your private balance in batches executed through Uniswap v4, with sandwich protection.
- **LPs earn from bets**: market fees are donated to the v4 pool's liquidity providers.
- **Anonymous reads**: every chain read goes through Anon-RPC.
- **Trustless resolution**: markets are resolved by a Chainlink CRE workflow.

Built at ETHGlobal Mumbai 2026. Runs on Ethereum Sepolia.

## Repository layout

```
circuits/     Noir circuits (spend, redeem)
contracts/    Foundry: ShieldedPool, Markets, ResolverReceiver, QuietOddsHook
relayer/      Node + viem relayer that submits proofs
cre/          Chainlink CRE resolution workflow
app/          Next.js frontend
deployments/  Deployed addresses
```

## License

MIT
