# QuietOdds: Lean 4 proofs

Machine-checked proofs (Lean 4 + Mathlib) that the arithmetic in QuietOdds' Noir
circuits and contract logic does what it claims. No `sorry`, no custom axioms.

## Build

```sh
cd lean
lake exe cache get   # download prebuilt Mathlib (do not compile it from source)
lake build
```

Toolchain: `leanprover/lean4:v4.35.0`, Mathlib tag `v4.35.0`. If `elan` is not on
your `PATH`: `export PATH="$HOME/.elan/bin:$PATH"`.

## What is proved

| # | Theorem | Models | Lean file |
|---|---------|--------|-----------|
| 1 | `spend_conserves_value`: with every term range-checked to 128 bits, the field equation `amount = change + public_amount + fee` holds over ℕ | `circuits/spend/src/main.nr` lines 50-54 | `QuietOdds/Spend.lean` |
| 2 | `redeem_payout_exact`: the 96-bit checks on `x, num, den, payout, remainder, den - remainder - 1` pin `payout = ⌊x·num/den⌋` and `remainder = x·num mod den` | `circuits/redeem/src/main.nr` lines 67-74 | `QuietOdds/Redeem.lean` |
| 2b | `redeem_fee_sound`: 128-bit checks on `fee` and `payout - fee` force `fee ≤ payout` and no wraparound | `circuits/redeem/src/main.nr` lines 77-79 | `QuietOdds/Redeem.lean` |
| 3 | `pro_rata_conserves`: if stakes sum to `D`, then `∑ ⌊xᵢ·N/D⌋ ≤ N`; `pro_rata_dust_lt_card`: `N < ∑ ⌊xᵢ·N/D⌋ + n` (dust < one unit per person); plus the real Sepolia batch #1 numbers | `BatchSwapper` / `Markets` redeem terms, consumed by `ShieldedPool.redeem` | `QuietOdds/ProRata.lean` |
| 4 | `sandwich_unprofitable`: a back-run fee `f ≥ (P₂-P₀)/P₀` makes a sandwich unprofitable; `sandwich_unprofitable_fee_rule` for our rule `base + (P₂-P₀)/P₀`; `capped_fee_counterexample`: the 50% cap fails once `P₂ > 2·P₀` | `contracts/src/QuietOddsHook.sol` lines 205-221 (`directionalFee`) | `QuietOdds/Sandwich.lean` |

Supporting: `QuietOdds/Field.lean` defines `p` (the BN254 scalar field modulus),
models Noir's `Field` as `ZMod p`, and `assert_uN(v)` as `v.val < 2^N` (the
canonical representative in `[0, p)` is below `2^N`). No theorem uses primality
of `p`, only its size.

## Trust gap (what these proofs do not cover)

- **Hand-transcribed constraints.** The circuit constraints were copied into Lean
  by hand; nothing checks that the Lean hypotheses match what the Noir compiler
  emits. Each hypothesis is doc-commented with the `main.nr` line it models.
- **Trusted toolchain.** We trust the Noir compiler, Barretenberg (prover and
  verifier), the generated Solidity verifier, and Poseidon (collision
  resistance, for Merkle membership, nullifiers and commitments, which are not
  modelled at all).
- **Theorems 3 and 4 model contract logic, not bytecode.** Theorem 3 relies on
  three Solidity facts that are tested, not proved: the `xᵢ` really sum to `D`,
  each note redeems once (nullifiers), and `N` is really in the pool.
  Theorem 4 is over ℝ: integer pips, the `sqrtPriceX96` encoding, the
  start-of-block snapshot and the BatchSwapper exemption are outside the model.
- **Theorem 4 limits.** The cost/revenue bounds are hypotheses (price
  monotonicity), not derived from `x·y = k`; the front-run is assumed to buy at
  `≥ P₀`; multi-block sandwiches are out of scope; and the contract's 50% fee
  cap breaks the guarantee when a block more than doubles the price (proved as
  `capped_fee_counterexample`).

## Axioms

`QuietOdds/Axioms.lean` runs `#print axioms` on each main theorem. Output of
`lake build`:

```
'QuietOdds.spend_conserves_value' depends on axioms: [propext, Quot.sound]
'QuietOdds.redeem_payout_exact' depends on axioms: [propext, Quot.sound]
'QuietOdds.redeem_fee_sound' depends on axioms: [propext, Classical.choice, Quot.sound]
'QuietOdds.pro_rata_conserves' depends on axioms: [propext, Classical.choice, Quot.sound]
'QuietOdds.pro_rata_dust_lt_card' depends on axioms: [propext, Classical.choice, Quot.sound]
'QuietOdds.sandwich_unprofitable' depends on axioms: [propext, Classical.choice, Quot.sound]
'QuietOdds.sandwich_unprofitable_fee_rule' depends on axioms: [propext, Classical.choice, Quot.sound]
'QuietOdds.capped_fee_counterexample' depends on axioms: [propext, Classical.choice, Quot.sound]
```

Only Lean's three standard axioms appear: no `sorryAx`, no custom axioms.
