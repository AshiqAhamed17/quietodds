# Uniswap v4 feedback

This is from building QuietOdds at ETHGlobal Mumbai 2026. We built:

- a hook with `beforeSwap`/`afterSwap` return deltas that deposits part of a swap into a shielded pool
- a directional dynamic fee and sandwich skim, ported from OpenZeppelin's `AntiSandwichHook`
- a batch swapper that swaps and donates through `unlock`
- use of the Trading API from a Next.js server route

Everything ran on Sepolia.

## What worked well

- **The `unlock` / callback model.** Once it clicked, batch swaps and fee donations were short. Open `unlock`, then `swap`, `settle` and `take` (or `donate`), and the PoolManager checks that every delta nets to zero. It caught accounting mistakes in tests before they reached Sepolia.
- **Return deltas.** Taking part of a swap's output inside the swap, without a second transaction, is what made "shield while you swap" possible. Having both `beforeSwap` and `afterSwap` return deltas let us support all four swap shapes (exact in/out × both directions) instead of reverting on two of them.
- **Dynamic fee override.** Returning `fee | OVERRIDE_FEE_FLAG` from `beforeSwap` let us charge a higher fee only on the back leg of a sandwich. It took very little code.
- **The deployments page as `llms.mdx`.** We pulled every Sepolia address (PoolManager, PositionManager, StateView, Quoter, Permit2) from it and could check it fast.
- **OpenZeppelin uniswap-hooks.** `AntiSandwichHook` was a good starting point.

## What was hard

1. **Compiler pinning.**
   - The problem: `PoolManager` pins `pragma solidity =0.8.26`, but our Barretenberg-generated verifiers need ≥ 0.8.27. Tests that import both can't compile in one unit.
   - Our workaround: deploy the verifiers with `deployCode` from their own build.
   - What would help: a note in the docs, or a looser pragma on the core contracts.

2. **Mining the hook address.**
   - HookMiner works. But when a constructor argument changes, the salt has to be mined again, and the circular setup made that painful: the pool key needs the hook, the hook needs our pool, and our pool wanted the pool key. We ended up with a one-time `setPoolKey` setter.
   - What would help: a docs example of the "hook ↔ app contract ↔ pool key" bootstrapping pattern.

3. **`AntiSandwichHook` details.**
   - It copies ticks into the checkpoint by looping from the current tick, about 3,000 iterations at tick −195k on our ETH/USDC pool. That ran out of gas, so we removed it, since the copied ticks were never read in our path.
   - `cp.state` moves forward through every one-for-zero swap it simulates, so it is not the start-of-block price. Our first directional fee read it and never triggered. We store the block-start price separately.
   - What would help: comments on both points in the contract.

4. **Quoting a hook whose fee depends on block state.**
   - The v4 Quoter simulates in the current block. A quote taken in the same block as a reversing swap shows the higher directional fee, while a quote taken in the next block doesn't.
   - That is correct, but it surprised us. A short docs note on quoting hooks with dynamic fees would help.

5. **`donate` needs in-range liquidity.**
   - Donating when no position is in range reverts.
   - This makes sense, but we only learned it from a failing test. It would help to say so in the `donate` NatSpec.

6. **Sepolia gas versus Foundry.**
   - Sepolia now runs a different gas schedule than Foundry's local EVM: code deposit cost and plain transfers both differ.
   - Our 18.7M-gas hook deploy failed until we broadcast with `--skip-simulation` and used the node's `eth_estimateGas`.
   - Not Uniswap's bug, but a line in the v4 testnet deployment guide would save people time.

## Trading API

- **It can't reach hooked pools.**
  - The API never routed through our hooked pool on Sepolia and has no way to pass `hookData`. We could only use it for comparison quotes and a plain "cash out to ETH" swap. Shield-on-swap has to go through our own route.
  - What would help: a way to target a specific v4 pool, or to pass `hookData`, even only on testnets.
- **Sepolia routes are badly mispriced.**
  - The API's public Sepolia routes gave 1 USDC → 0.00009 ETH, while our pool (priced from Chainlink) gave 0.000445, a 5× gap. In the other direction the API won.
  - That's expected on a testnet, but a warning in the API docs would stop people trusting testnet quotes.
- **Getting started was smooth.** Getting a key at developers.uniswap.org and calling `/quote`, `/check_approval` and `/swap` from a server route was straightforward.

## Wishlist

- A guide on hooks that hold user funds or call into other protocols during `afterSwap`. In particular: reentrancy expectations, and what is safe to call while the PoolManager is unlocked.
- An official example of a dynamic-fee hook that reads "price at the start of the block". We think anti-MEV hooks will need this pattern a lot.
- Being able to pass `hookData` through the Universal Router and the Trading API for privacy and intent-style hooks.
