# QuietOdds

**A private prediction market and a privacy layer for Uniswap v4.**

The odds are public. Who's betting isn't.

- **Live app:** https://quietodds.vercel.app (Ethereum Sepolia)
- **Relayer:** https://quietodds-relayer.vercel.app/health
- Built at ETHGlobal Mumbai 2026.

On today's prediction markets and DEXs, every bet and every swap is tied to your wallet forever. Anyone can see what you backed, how much, and when, and bots can see your swap coming. QuietOdds lets you deposit once into a shielded pool and then do everything else privately: bet, claim, swap in batches and withdraw. Each action is a zero-knowledge proof made in your browser and submitted by a relayer.

| What you can do | How it stays private |
|---|---|
| **Bet** on F1, football and crypto prices | A Noir proof spends a hidden note. The relayer sends the tx, so the chain only sees "someone bet 1 USDC on side 1". |
| **Shield inside a Uniswap swap** | Our v4 hook takes part of the swap output and deposits it into the shielded pool in the same swap. A queued private bet follows minutes later from the relayer. |
| **Batch swap privately** | You join a batch from your hidden balance. Every 5 minutes the batch swaps through the v4 pool as one trade, with a Chainlink price floor. |
| **Claim winnings** | A second circuit proves your payout `⌊stake·pot/winningSide⌋` and gives it back as a new hidden note. |
| **Withdraw** to any address | The recipient is bound in the proof. It can be a fresh wallet with 0 ETH. |
| **Browse** without leaking your IP | Every read the app makes goes through the EF's Anon-RPC mixnet. |

Markets settle through a **Chainlink CRE** workflow (ESPN for sports and F1, Chainlink price feeds for crypto). The money rules are **proved in Lean 4**.

---

## Architecture

```
 Browser (Next.js, quietodds.vercel.app)
 ├─ keys from a wallet signature or passkey (never leave memory)
 ├─ scan + decrypt notes ───────── reads ──► Anon-RPC mixnet ──► Sepolia RPC
 ├─ Noir proof (bb.js UltraHonk, in browser)
 └─ wallet txs: deposit, swap through the hook
            │ proof
            ▼
 Relayer (quietodds-relayer.vercel.app): verify proof → simulate → send, pays gas
            │
            ▼
 ┌──────────────────────── Sepolia ─────────────────────────────┐
 │ ShieldedPool ── Poseidon Merkle tree (depth 20), nullifiers   │
 │   ├─ SpendVerifier / RedeemVerifier (UltraHonk)               │
 │   ├─ Markets (2–4 sides, 1% fee) ◄── ResolverReceiver ◄── CRE │
 │   └─ BatchSwapper ── unlock → swap / donate ──┐               │
 │ Uniswap v4 PoolManager ◄──────────────────────┘               │
 │   └─ ETH/USDC pool + QuietOddsHook (shield on swap,           │
 │      directional fee, sandwich skim → LPs)                    │
 └───────────────────────────────────────────────────────────────┘
 Chainlink CRE workflow (cron): ESPN / price feeds → report → ResolverReceiver
   = resolve markets, execute due batches, donate market fees to LPs
```

### Notes

Every private balance is a Poseidon commitment in one Merkle tree:

- **Balance note:** `H(1, asset, amount, precommitment)`
- **Position note** (a bet): `H(2, market, side, stake, precommitment)`
- **Ticket note** (a batch share): `H(3, batch, amountIn, precommitment)`

Notes are encrypted to your viewing key and posted on chain as ciphertext. Logging in on a new browser rescans the tree and recovers all of them.

---

## Deployed contracts (Sepolia, all verified on Etherscan)

| Contract | Address |
|---|---|
| ShieldedPool | [`0xAC064dfd9713688dBDD90443C80c5161cdA20d95`](https://sepolia.etherscan.io/address/0xAC064dfd9713688dBDD90443C80c5161cdA20d95) |
| Markets | [`0x42A29a66812aBDdCE241521E2E510885F3d38229`](https://sepolia.etherscan.io/address/0x42A29a66812aBDdCE241521E2E510885F3d38229) |
| QuietOddsHook | [`0x44Bca011EC6939c5621aa90Da0351835875200Cc`](https://sepolia.etherscan.io/address/0x44Bca011EC6939c5621aa90Da0351835875200Cc) |
| BatchSwapper | [`0x027Fc4CE56eCBcC1dFabc1BD0a66EdEa2123d3bc`](https://sepolia.etherscan.io/address/0x027Fc4CE56eCBcC1dFabc1BD0a66EdEa2123d3bc) |
| ResolverReceiver | [`0x5d83961b7F18EB5AeB61eFef67A84591A3d52BAC`](https://sepolia.etherscan.io/address/0x5d83961b7F18EB5AeB61eFef67A84591A3d52BAC) |
| SpendVerifier | [`0xae49c6b47AB8Aa5d82b0b5315cEfC2DC4A758382`](https://sepolia.etherscan.io/address/0xae49c6b47AB8Aa5d82b0b5315cEfC2DC4A758382) |
| RedeemVerifier | [`0x95Fdb53CE9EFf556BDE64289F1F3CbBcD842aCC0`](https://sepolia.etherscan.io/address/0x95Fdb53CE9EFf556BDE64289F1F3CbBcD842aCC0) |
| Relayer EOA | [`0x7deff3a32db3f55d8d571e4f19a57d87ed07c02f`](https://sepolia.etherscan.io/address/0x7deff3a32db3f55d8d571e4f19a57d87ed07c02f) |

- **v4 pool:** ETH/USDC with a dynamic fee and tick spacing 60. Pool id `0xaa8937888c0c0d5ea3e997b19c6c9104502f0c51aa25412a062c8234d31bba1b`, full-range position NFT 41433.
- **Full address list:** [`deployments/`](deployments/), which also includes the Uniswap, Chainlink, CRE and Anon-RPC addresses we use.

---

## It works on Sepolia: transaction log

Every hash below is a real Sepolia transaction. The run used three test wallets (Priya, Rahul and Arjun), the live relayer, the v4 hook and CRE. Script outputs are in [`deployments/batch-e2e-sepolia.json`](deployments/batch-e2e-sepolia.json). Hashes link to Etherscan.

**Look at the sender of each private action. It is always the relayer, never the user.**

| # | Step | Tx |
|---|---|---|
| 1 | Priya deposits 4 USDC (public, from her wallet) | [0x5a0b…2bab](https://sepolia.etherscan.io/tx/0x5a0bb2f6997e26864995e954295219b05ab62c071a20a4c197f96bf8d7482bab) |
| 1 | Rahul deposits 4 USDC | [0x4b04…72c0](https://sepolia.etherscan.io/tx/0x4b04b6a09348c9ee78c7ecc7219445f1a3a61d792d3e78e9546c2f18e7fb72c0) |
| 1 | Arjun deposits 4 USDC | [0x0d79…7e8a](https://sepolia.etherscan.io/tx/0x0d7917367ec9cf4df1226d7b148163776eb868330eebb3fa6b4b6a1957bb7e8a) |
| 2 | Priya's private bet, 1 USDC on side 0 (relayed) | [0x6945…9f2c](https://sepolia.etherscan.io/tx/0x6945c16a0adb39e6e56be730c774b8322e265d4a1b5e32879562cae31df49f2c) |
| 2 | Rahul's private bet, 1 USDC on side 2 (relayed) | [0x8618…7f27](https://sepolia.etherscan.io/tx/0x8618f9beec71990c2f13926acb065c284a25bed1eaf34dad0a9ca4f83131d27f) |
| 2 | Arjun's private bet, 1 USDC on side 1 (relayed) | [0xdee5…e624](https://sepolia.etherscan.io/tx/0xdee508bcde25762d4e1678de49df38f273d31254f1b16dfba7ba225687c0e624) |
| 2 | Swap 2 USDC → ETH through the hook, shielding 1 USDC in the same swap | [0x9240…7473](https://sepolia.etherscan.io/tx/0x924058a19bb4e1166c93f1373f78dea718659ebd9f9514121863f86e043d7473) |
| 2 | …the queued private bet from that shielded USDC, minutes later (relayed) | [0x135f…9d9b](https://sepolia.etherscan.io/tx/0x135f6fcabacc1873ae01eb680e70b0972c200afcfbb79a17b01766c5eac49d9b) |
| 3, 5, 7 | **One CRE report:** resolves market 1 (Arsenal), swaps batch #1 through the v4 pool (3.2 USDC → 0.001393 WETH, floor 0.001370) and donates 0.03 USDC of fees to LPs | [0xc74f…80e7](https://sepolia.etherscan.io/tx/0xc74f806af868206ff80adb6b14515d8b70506473753788e6bf15b389bbb080e7) |
| 5 | Priya, Rahul and Arjun join batch #1 privately (relayed) | [0xd12e…5e56](https://sepolia.etherscan.io/tx/0xd12e9690efd9847545098ea1d6976557464d240e4022dee1aaa93efedfa45e56), [0xf8b1…3c8c](https://sepolia.etherscan.io/tx/0xf8b1fe608871e839ef089df48591ea7f7473144d1b5415ff6edfba7f072e3c8c), [0x2bb1…0ad8](https://sepolia.etherscan.io/tx/0x2bb17e5b437db15c182ef2374ff9f234dd8ff40799dfdcc3d95c42ffdd9d0ad8) |
| 6 | Three batch tickets redeemed for hidden WETH notes (relayed) | [0xe378…34d0](https://sepolia.etherscan.io/tx/0xe378c3921459905bf6e7a98005706b2d0c44a333a20a5be11687dd5eb7cb34d0), [0x5b14…3bdb](https://sepolia.etherscan.io/tx/0x5b14af719bc1c7707f86eb0cff9d9d1a7c4ad07af868045cf22ca7a959f93bdb), [0xb964…9d0c](https://sepolia.etherscan.io/tx/0xb964c72fe2910d1d5df02951926b91ab425f96c6215cd3402d91aca544879d0c) |
| 4 | Rahul claims his win on market 1: 2.97 USDC as a hidden note (relayed) | [0x1045…3cec](https://sepolia.etherscan.io/tx/0x104513473c8d9b91992feed13052d1367ad89a84fd4cc5706e4786784e503cec) |
| 8 | Priya withdraws 0.000482 WETH to a **fresh address with 0 ETH** ([`0x5c69…B317`](https://sepolia.etherscan.io/address/0x5c6926b24f016518dC510f203a3455220A5fB317), nonce 0) | [0x24fb…f566](https://sepolia.etherscan.io/tx/0x24fbf8602c04d2d13dd9307fec64814ae1dbefa38ea5000ea4bd49156270f566) |

**From the live app (browser proofs):**

| Step | Tx |
|---|---|
| Private bet placed from quietodds.vercel.app | [0xf5df…0c1d](https://sepolia.etherscan.io/tx/0xf5df610021a0080599e351119412c7acb629bc74bb3d27688f72696c950f0c1d) |
| Batch #3 executed from the batch page (permissionless) | [0xfc50…c7ef](https://sepolia.etherscan.io/tx/0xfc50f7af4756eeeae8c1558dfa615a3c6725e6f002b4e654707fe55b0f62c7ef) |
| Swap through the hook from the swap page, shielding 3 USDC | [0x66e9…2d64](https://sepolia.etherscan.io/tx/0x66e90117827555d49592aa2d0f35f116a14958127fd2b415e502ee5947222d64) |
| Private bet of 5 USDC on the F1 replay market #21 | [0x0ee6…e383](https://sepolia.etherscan.io/tx/0x0ee65e35d0b0be08466f80b246584c1a80228b251ff4776f40bf8209841de383) |
| CRE resolves the F1 replay from ESPN (Verstappen), cancels an empty market, donates fees | [0xfbef…e3f8](https://sepolia.etherscan.io/tx/0xfbef8a32c38e693c48876dcd3d31df9ecdec38f0a37ff909d22179e91eafe3f8) |
| Winnings claimed as a hidden note | [0x9f52…a52a](https://sepolia.etherscan.io/tx/0x9f52b342ac58886651dc0ef607c34c6194e8b9631d12d140414ba95a9deaa52a) |
| CRE resolves a Chainlink price market (ETH > $2,300), cancels three ESPN markets that got no bets, and donates fees, in one report | [0x30ff…12c1](https://sepolia.etherscan.io/tx/0x30ff9752b0b87244a26f024cddddd481dde39a5f81e360b39b86a9b5e16212c1) |

**Typical Sepolia gas:**

| Action | Gas |
|---|---|
| Deposit | 1.2M |
| Relayed private bet | ~6.0M (UltraHonk verify ≈ 2.4M plus two tree inserts) |
| Batch join | 5.7M |
| Redeem | 4.9M |
| Withdraw | 5.0M |
| Shielded swap | 1.4–1.9M |
| CRE report (resolve + batch + donate) | 1.46M |

---

## Uniswap v4: where to look

The hook is [`contracts/src/QuietOddsHook.sol`](contracts/src/QuietOddsHook.sol). It uses `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta` and `afterSwapReturnDelta` (permissions at L116).

| What | Where |
|---|---|
| **Shield on swap:** the swap's `hookData` carries `(amount, precommitment, ciphertext)`. In `afterSwap` the hook takes that much USDC out of the output (`poolManager.take`, L295) and deposits it into the ShieldedPool as a hidden note (L296). The returned unspecified delta charges the swapper for it (L197). All 4 swap shapes (exact in/out × both directions) work. | `_afterSwap` L185–198, `_shield` L273–298 |
| **Return deltas:** when USDC is the swap's specified currency, `beforeSwap` claims the shield amount up front with a `BeforeSwapDelta` (the pool then swaps the specified amount minus the shield for exact-in, plus it for exact-out). Otherwise `afterSwap` takes it from the unspecified side. | L137–183, delta at L180 |
| **Directional dynamic fee** (anti-sandwich, back leg): the hook remembers the block's starting price. A swap that reverses the block's move pays `base + (P₂−P₀)/P₀`, returned as an LP fee override. | `directionalFee` L205, override L159 |
| **Sandwich skim** (from OpenZeppelin's `AntiSandwichHook`): a one-for-zero swap that would get more than the block-start price has the extra skimmed and donated to in-range LPs in the same swap. | `_skim` L246–270, `poolManager.donate` L265 |
| **Batch swaps through `unlock`:** `executeBatch` opens `poolManager.unlock`. The callback swaps the whole batch, settles the input and takes the output. `minOut` is the Chainlink price minus slippage. | [`BatchSwapper.sol`](contracts/src/BatchSwapper.sol) `executeBatch` L192, `unlockCallback` L231, `_swap` L240, `minOutFor` L304 |
| **LP donate:** the 1% market fees go to the pool's LPs via `poolManager.donate`. | `donateFees` L221, `_donate` L268 |
| **Trading API:** a server route proxies `/quote`, `/check_approval` and `/swap` (key server-side) for comparison quotes and plain cash-out swaps. | `app/app/api/uniswap/` |

Hook tests are in `contracts/test/QuietOddsHook.t.sol` and `DirectionalFee.t.sol`:

- Fuzzing over all 4 swap shapes checks that the taken amount equals the shield amount and that balances are exact.
- 1,000-run sandwich fuzz: the attacker loses in both directions, while the same sandwich on a static-fee pool profits.

## Zero-knowledge circuits (Noir + UltraHonk)

| Circuit | What it checks |
|---|---|
| [`circuits/spend/src/main.nr`](circuits/spend/src/main.nr) (25,683 gates) | Note in the tree (L44); nullifier (L47); `amount = change + public + fee` with 128-bit range checks (L50–54); change note (L57). Binds the action (withdraw / bet / batch join), market, side, relayer, fee and recipient as public inputs, so a relayer can't redirect anything. |
| [`circuits/redeem/src/main.nr`](circuits/redeem/src/main.nr) (27,668 gates) | Position or ticket in the tree (L55); winning side (L63); `payout = ⌊x·num/den⌋` via a range-checked remainder (L67–74); fee ≤ payout and the output note (L77–80). The contract supplies `num/den` from Markets or BatchSwapper, never the user. |

- Proofs are made in the browser with bb.js (multi-threaded under COOP/COEP) in about 1 second.
- Verifiers are generated by `bb` and verified on chain.

## Chainlink CRE

The workflow is in [`cre/resolver/`](cre/resolver/) (TypeScript, cron trigger):

1. **Read** every market, both open batches and the accrued fees. It uses one Multicall3 `aggregate3`, because CRE allows 15 chain reads per run.
2. **Fetch results:** sports and F1 results come from ESPN through `HTTPClient` with median consensus. Price markets read Chainlink feeds.
3. **Send one report** to `ResolverReceiver.onReport` ([L67](contracts/src/ResolverReceiver.sol)). It carries a list of actions: RESOLVE, CANCEL, EXECUTE_BATCH and DONATE_FEES. The receiver accepts only the forwarder and the expected workflow owner.

Pure parsing logic and its tests: `cre/resolver/logic.ts` and `main.test.ts`. F1 race winners are read from ESPN's `winner` flag, and unlisted drivers go to "Anyone else".

```sh
cd cre && cre workflow simulate resolver --target staging-settings \
  --non-interactive --trigger-index 0 -e ../.env --broadcast
```

We run it with `simulate --broadcast` (real reports to Sepolia through the simulation forwarder), not on a deployed DON.

## Anon-RPC

Every read the app makes goes through the EF's Anon-RPC:

- **What is covered:** odds, pool state, note scanning, Merkle paths, batch state.
- **How:** [`app/lib/wagmi.ts`](app/lib/wagmi.ts) L13 sets the one wagmi transport with `fetchFn: anonFetch`, and [`app/lib/anonRpc.ts`](app/lib/anonRpc.ts) runs one hash-pinned `AnonRpcWorker` per tab. Reads are batched so each mixnet round trip carries many calls.
- **Default:** it is on by default. The nav chip shows the live state and lets you turn it off.

**Why it matters here.** A shielded pool hides the link between deposit and spend on chain. But an RPC node could see an IP read the Merkle tree and fetch a path, and then see the relayer submit a spend seconds later. That timing would link the two. Routing reads through the mixnet removes that link.

What is **not** covered, honestly:

- **Wallet transactions** (deposits, swaps) go through the wallet's own RPC.
- **The worker's one-time bootstrap read** of the public Nox specifier contract is direct.
- **Other direct requests:**
  - The optional Coinbase candle chart, labelled in the UI.
  - Our relayer. It sees the proof, not your IP's history.
  - The Uniswap API proxy, which is server-side.
- **Fallback:** after 3 failed mixnet requests in a row, reads go direct while the worker reconnects (backoff from 15s to 120s). The chip says "Reconnecting · direct reads" while that happens.

## Lean 4 proofs

[`lean/`](lean/) has machine-checked proofs of the money rules (Lean 4 + Mathlib, zero `sorry`, standard axioms only). `cd lean && lake exe cache get && lake build`.

| Theorem | Shows |
|---|---|
| `spend_conserves_value` | The circuit's field equation plus 128-bit checks really means `amount = change + public + fee` over ℕ (no wraparound) |
| `redeem_payout_exact` | The 96-bit checks pin `payout = ⌊x·num/den⌋` exactly |
| `pro_rata_conserves` | Winners together can never take more than the pot, and dust is less than one unit per person |
| `sandwich_unprofitable_fee_rule` | The hook's directional fee makes a one-block sandwich unprofitable. `capped_fee_counterexample` shows where the 50% cap stops it. |

[`lean/README.md`](lean/README.md) has the theorem → circuit line table and the trust gap. The constraints were transcribed by hand, and the toolchain is trusted.

## Tests

| Command | Count |
|---|---|
| `cd circuits && nargo test` | 36 |
| `cd contracts && forge test` | 118, including real proof fixtures, fuzzing and invariants |
| `cd cre/resolver && bun test` | 15 |

- **Circuit tests** cover wrong side, bad path, inflated payout and overflow.
- **Contract invariant:** pool balance ≥ unspent notes + pending batch inputs.
- **Revert tests** cover a reused nullifier, unknown root, bet after close, claim before resolve, and a tampered relayer, fee or recipient.

## Honest limitations

- **One note per spend.** There is no 2-input join-split, so an action can use at most your largest note minus the fee. The app says so up front.
- **Anonymity set.** Testnet pool with few users. Deposit and withdrawal amounts and timing can still be matched by an observer. The delayed bet queue and batches help, but don't remove this.
- **Relayer.** It can't steal or redirect (everything is bound in the proof), but it can refuse to relay. Anyone can run one, but there is no self-submit button in the UI yet.
- **Resolution.** ESPN is a single data source. The fallback is cancel and refund. CRE runs as `simulate --broadcast`, not a deployed DON.
- **Curated markets.** Only the owner creates markets.
- **Thin pool.** The testnet pool is thin, so batch slippage is set to 5% (the contract default is 1%).
- **Not post-quantum.** UltraHonk uses KZG on BN254.
- **Not audited.** Tested and partly formally verified.

More in [`docs/threat-model.md`](docs/threat-model.md).

## Repository layout

| Folder | Contents |
|---|---|
| `circuits/` | Noir: `spend`, `redeem`, shared `lib` (notes, Merkle) |
| `contracts/` | Foundry: ShieldedPool, Markets, BatchSwapper, ResolverReceiver, QuietOddsHook, verifiers |
| `lib/` | Shared TS: keys, notes, Poseidon, Merkle, prover, relay client |
| `relayer/` | Hono + viem relayer: verify, simulate, send; fee quotes, rate limits, no IP logs |
| `cre/` | Chainlink CRE resolution workflow |
| `app/` | Next.js app |
| `lean/` | Lean 4 proofs |
| `scripts/` | Sepolia e2e runs, market creation, pool rebalance |
| `deployments/` | Addresses and recorded runs |

## Run it locally

```sh
npm install
cp .env.example .env                    # testnet keys only
npm run dev -w app                      # http://localhost:3000
npm run dev -w relayer                  # http://localhost:8787
npm run markets -w scripts -- demo 8    # replay markets that close in 8 min
```

To try it on the live app, you need Sepolia ETH and [Circle faucet USDC](https://faucet.circle.com).

1. Connect a wallet and unlock. This signs once to derive your keys.
2. Deposit at least 1.05 USDC.
3. Bet, swap, batch, claim and withdraw.

Built on Uniswap v4, Chainlink CRE, Anon-RPC, Noir and Lean.

## License

MIT
