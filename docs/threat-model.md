# QuietOdds threat model

What QuietOdds protects, who could attack it, and where the limits are. This covers the hackathon build on Sepolia. It is not audited.

## What we protect

1. **Funds.** Nobody can take, create or redirect money in the shielded pool.
2. **Unlinkability.** After a deposit, an observer can't tell which wallet placed a bet, picked a side, joined a batch, claimed a payout or made a withdrawal.
3. **Fair settlement.** Markets resolve to the real result, and payouts follow the pro-rata rule exactly.
4. **Swappers and LPs.** Swappers on our pool, and LPs, are protected from one-block sandwich attacks.

## Assumptions

- Poseidon is collision resistant.
- UltraHonk (KZG on BN254) is sound. The Noir compiler, Barretenberg and the generated Solidity verifiers are correct. This is not post-quantum.
- Ethereum (Sepolia) is live and finalises.
- The user's keys stay in their browser. Keys are derived from a wallet signature or a passkey and live in memory only.

## Actors

### Relayer

- **Can't:**
  - **Steal or redirect funds.** The recipient, relayer address, fee, action, market and side are all public inputs to the proof. Changing any of them makes the proof invalid.
  - **Replay a spend.** Nullifiers are stored on chain.
- **Can:**
  - **Refuse to relay (censorship).** Mitigation: the relayer is a stateless open-source service that anyone can run. A proof can be sent by any address, and the pool doesn't care who submits it. There is no self-submit button in the UI yet.
  - **See the proof's public inputs** (amount, market, side) and the requester's IP. It doesn't keep IP logs and rate-limits by IP in memory only. The amount, market and side become public on chain anyway.

### RPC node

- **The risk:** without protection, the node sees your IP read the Merkle tree, fetch your note's path and poll a market. Seconds later the relayer submits a spend against that root. That timing links your IP to the bet.
- **Mitigation:** every read the app makes goes through the EF's Anon-RPC mixnet (`app/lib/wagmi.ts`, `app/lib/anonRpc.ts`).
- **Gaps:**
  - Wallet transactions use the wallet's RPC.
  - The worker's one-time bootstrap read is direct.
  - After 3 failed mixnet requests in a row, reads go direct until the worker reconnects. The UI says so.

### On-chain observer

- **Sees:** deposits (public, from your wallet), relayed spends (amount, market, side, from the relayer), withdrawals (amount, recipient), and batch totals.
- **Can try to link you by:**
  - **Amounts:** for example, deposit 7.31 USDC and withdraw 7.26 later.
  - **Timing:** a deposit followed by a bet a moment later.
  - **A small anonymity set:** few users on testnet.
- **Mitigations:**
  - Round amounts work best.
  - Queued bets after a swap wait a random 1–10 minutes.
  - Batches merge everyone into one trade.
  - Change notes split balances.
- **Not solved:** strong timing and amount correlation with few users. Privacy grows with the number of users.

### Resolver (Chainlink CRE + data sources)

- **Who can report:** `ResolverReceiver` only accepts reports from the configured forwarder and workflow owner.
- **Price markets:**
  - They read Chainlink feeds.
  - `resolveFromFeed` is also permissionless, but only with a feed update at or after close time and no older than the staleness limit.
- **Sports and F1:**
  - Results come from ESPN, with median consensus across CRE nodes. That is a single data source, so a wrong ESPN result means a wrong resolution.
  - A market whose winning side has no stake is cancelled and refunded. The owner can cancel stale markets.
  - Future work: a multi-source check and a dispute window.
- **Hackathon caveat:** for the hackathon, CRE runs as `cre workflow simulate --broadcast` from our machine, not a deployed DON. The trust is in our operator key plus the simulation forwarder, until it is deployed.

### Market creator (owner)

- **Can:**
  - Create markets (curated).
  - Set slippage within bounds.
  - Cancel stale markets and batches. Both refund 1:1.
- **Can't:**
  - Move user funds.
  - Change a market's outcome after it is resolved.
- **Not done:** no multisig or timelock in the hackathon build.

### MEV searchers

- **Sandwiching a swap on our pool:**
  - The hook stores the price at the start of the block.
  - A swap that reverses the block's move pays `base + (P₂ − P₀)/P₀`.
  - One-for-zero swaps that would beat the block-start price have the difference skimmed to LPs.
- **Proof:** `lean/QuietOdds/Sandwich.lean` proves a one-block sandwich isn't profitable under that fee. `capped_fee_counterexample` shows the 50% cap stops protecting once the price more than doubles in a block.
- **Not covered:** multi-block attacks.
- **Sandwiching a batch:**
  - `minOut` comes from Chainlink minus slippage, so a manipulated pool makes `executeBatch` revert instead of filling badly.
  - A front-run before a batch only gives the batch a better price.
  - The BatchSwapper is exempt from the directional fee, because two opposite batches can run in one block.
- **Dust griefing on batches:** minimum join is 1 USDC or 0.0005 WETH.

## Contract-level risks

| Risk | Mitigation |
|---|---|
| Value created inside the circuit by field wraparound | 128-bit range checks on every amount; `spend_conserves_value` proves the field equation then holds over ℕ |
| Payout rounding drains the pot | `payout = ⌊x·num/den⌋` pinned by range-checked remainder (`redeem_payout_exact`); `pro_rata_conserves` proves the sum ≤ pot; dust stays in the pool |
| User chooses their own payout ratio | `num/den/side` come from `Markets.redeemTerms` / `BatchSwapper.redeemTerms`, not the user |
| Double spend | Nullifier set; reused nullifier reverts (tested) |
| Stale or fake Merkle root | 64-root history; unknown root reverts (tested) |
| Hook delta accounting errors | PoolManager enforces zero net deltas; fuzz over all 4 swap shapes checks the taken amount and balances |
| Reentrancy via hook → pool deposit | The pool takes hook deposits through its normal `deposit` path; `nonReentrant` on spend, redeem, executeBatch and donateFees |
| Pool insolvency | Invariant test: token balance ≥ unspent notes + pending batch inputs |

## Note loss

- **Recovery:** keys are deterministic (the same wallet signature or passkey gives the same keys), and every note is posted on chain encrypted to the viewing key. Logging in on a new browser rescans and recovers everything.
- **Risks:**
  - Losing the wallet or passkey loses the notes.
  - Anyone with the viewing key can see (not spend) your history.

## Out of scope

- A compromised browser or extension: it can read keys from memory.
- Front-end supply chain: the app is served from Vercel.
- Network-level attacks on the relayer or Vercel.
- Legal and compliance questions around private betting.
